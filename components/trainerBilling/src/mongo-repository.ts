import mongoose, { Schema } from "mongoose";
import { randomUUID } from "node:crypto";
import { Account, BillingError, EventRecord, Mode, Projection, Repository, User } from "./types";

export interface LegacyUsers {
  getUser(id: string): Promise<User | null>;
  project(account: Account, value: Projection): Promise<void>;
  clientUsage(id: string): Promise<number>;
}
interface AccountDocument extends Account { leaseOwner?: string | null; leaseUntil?: Date }
interface StoredEvent extends EventRecord { lastAttemptAt?: Date; processedAt?: Date }
const accountSchema = new Schema<AccountDocument>({
  userId: { type: String, required: true }, mode: { type: String, required: true, enum: ["test", "live"] },
  customerId: String, customerStartedAt: Date,
  checkout: { key: String, priceId: String, startedAt: Date, sessionId: String, url: String },
  subscriptionId: String, status: { type: String, default: "none" }, tier: String, interval: String,
  paidUntil: Date, currentPeriodEnd: Date, cancelAtPeriodEnd: { type: Boolean, default: false },
  revision: { type: Number, default: 0 }, deletedAt: Date, leaseOwner: String,
  provider: Schema.Types.Mixed, quote: Schema.Types.Mixed, change: Schema.Types.Mixed,
  control: Schema.Types.Mixed, pendingPayment: Schema.Types.Mixed,
  renewal: Schema.Types.Mixed, renewalPayment: Schema.Types.Mixed, review: Schema.Types.Mixed,
  leaseUntil: { type: Date, default: () => new Date(0) },
}, { timestamps: true, collection: "trainerbillingaccounts", autoCreate: false, autoIndex: false });
accountSchema.index({ userId: 1, mode: 1 }, { unique: true });
accountSchema.index({ customerId: 1, mode: 1 }, { unique: true, partialFilterExpression: { customerId: { $type: "string" } } });
accountSchema.index({ updatedAt: 1 });
const eventSchema = new Schema<StoredEvent>({
  eventId: { type: String, required: true }, mode: { type: String, required: true }, type: String,
  customerId: String, status: { type: String, enum: ["pending", "processed", "failed"], default: "pending" },
  attempts: { type: Number, default: 0 }, lastAttemptAt: Date, processedAt: Date, detail: Schema.Types.Mixed,
}, { timestamps: true, collection: "trainerbillingevents", autoCreate: false, autoIndex: false });
eventSchema.index({ eventId: 1, mode: 1 }, { unique: true });
eventSchema.index({ status: 1, lastAttemptAt: 1 });
const AccountModel = mongoose.model<AccountDocument>("TrainerStripeAccount", accountSchema);
const EventModel = mongoose.model<StoredEvent>("TrainerStripeEvent", eventSchema);

function duplicate(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}

export class MongoRepository implements Repository {
  private initialization?: Promise<unknown>;
  constructor(private users: LegacyUsers, private mode: Mode = "test") {}
  async init(): Promise<void> {
    const connection = mongoose.connection;
    const sandboxDb = ["127.0.0.1", "localhost", "::1"].includes(connection.host) && connection.name === "trainfit_stripe_local";
    // Sandbox data only ever lives in the isolated local DB; live data never does.
    if (connection.readyState !== 1 || (this.mode === "test" ? !sandboxDb : connection.name === "trainfit_stripe_local")) {
      throw new BillingError(this.mode === "test" ? "LOCAL_DATABASE_REQUIRED" : "LIVE_DATABASE_REQUIRED", this.mode === "test"
        ? "Los pagos de prueba requieren la base de datos local aislada." : "Los pagos reales no pueden usar la base de datos de pruebas.", 503);
    }
    this.initialization ||= Promise.all([AccountModel.createIndexes(), EventModel.createIndexes()]).catch((error: unknown) => {
      this.initialization = undefined;
      throw error;
    });
    await this.initialization;
  }
  async get(userId: string): Promise<Account | null> {
    return AccountModel.findOne({ userId, mode: this.mode }).lean().exec();
  }
  async findCustomer(customerId: string): Promise<Account | null> {
    return AccountModel.findOne({ customerId, mode: this.mode }).lean().exec();
  }
  async withLock<T>(userId: string, action: (account: Account, save: () => Promise<void>) => Promise<T>): Promise<T> {
    await this.init();
    const identity = { userId, mode: this.mode };
    // Mongoose 6 adds __v to the insertion payload in place. Never share it
    // with the lease filter: imported records need not have a version key.
    try { await AccountModel.updateOne(identity, { $setOnInsert: { ...identity } }, { upsert: true }); }
    catch (error) { if (!duplicate(error)) throw error; }
    const owner = randomUUID();
    const leaseMs = 120000;
    const row = await AccountModel.findOneAndUpdate({ ...identity, leaseUntil: { $lte: new Date() } },
      { $set: { leaseOwner: owner, leaseUntil: new Date(Date.now() + leaseMs) } }, { new: true }).lean().exec();
    if (!row) throw new BillingError("BILLING_BUSY", "Hay una operación de pago en curso. Vuelve a intentarlo.");
    let lost = false;
    const timer = setInterval(() => {
      void AccountModel.updateOne({ ...identity, leaseOwner: owner, leaseUntil: { $gt: new Date() } },
        { $set: { leaseUntil: new Date(Date.now() + leaseMs) } }).then((result) => {
        if (!result.matchedCount) lost = true;
      }).catch(() => { lost = true; });
    }, 15000);
    timer.unref();
    const account: Account = row;
    const save = async () => {
      if (lost) throw new BillingError("BILLING_BUSY", "La operación necesita reintentarse.");
      const revision = account.revision + 1;
      const result = await AccountModel.updateOne({ ...identity, leaseOwner: owner, leaseUntil: { $gt: new Date() } }, { $set: {
        customerId: account.customerId, customerStartedAt: account.customerStartedAt,
        checkout: account.checkout || null, subscriptionId: account.subscriptionId || null,
        status: account.status, tier: account.tier || null, interval: account.interval || null,
        paidUntil: account.paidUntil || null, currentPeriodEnd: account.currentPeriodEnd || null,
        cancelAtPeriodEnd: account.cancelAtPeriodEnd, revision, deletedAt: account.deletedAt || null,
        provider: account.provider || null, quote: account.quote || null, change: account.change || null,
        control: account.control || null, pendingPayment: account.pendingPayment || null, review: account.review || null,
        renewal: account.renewal || null, renewalPayment: account.renewalPayment || null,
      } });
      if (!result.matchedCount) throw new BillingError("BILLING_BUSY", "La operación necesita reintentarse.");
      account.revision = revision;
    };
    try { return await action(account, save); }
    finally {
      clearInterval(timer);
      await AccountModel.updateOne({ ...identity, leaseOwner: owner }, { $set: { leaseOwner: null, leaseUntil: new Date(0) } });
    }
  }
  async project(account: Account, value: Projection): Promise<void> { await this.users.project(account, value); }
  async getUser(userId: string): Promise<User | null> { return this.users.getUser(userId); }
  async clientUsage(userId: string): Promise<number> { return this.users.clientUsage(userId); }
  async saveEvent(record: EventRecord): Promise<EventRecord> {
    await this.init();
    const query = { eventId: record.eventId, mode: this.mode };
    // Retried events may be lean Mongo records containing _id/timestamps. Only
    // insert business fields: updatedAt in $setOnInsert conflicts with timestamps.
    const insertion: EventRecord = { eventId: record.eventId, mode: this.mode, type: record.type,
      customerId: record.customerId, status: "pending", attempts: 0, detail: record.detail || null };
    try { await EventModel.updateOne(query, { $setOnInsert: insertion }, { upsert: true }); }
    catch (error) { if (!duplicate(error)) throw error; }
    const event = await EventModel.findOneAndUpdate(query,
      { $inc: { attempts: 1 }, $set: { lastAttemptAt: new Date() } }, { new: true }).lean().exec();
    if (!event) throw new Error("Event persistence failed");
    return event;
  }
  async completeEvent(eventId: string): Promise<void> {
    await EventModel.updateOne({ eventId, mode: this.mode }, { $set: { status: "processed", processedAt: new Date() } });
  }
  async failEvent(eventId: string): Promise<void> {
    await EventModel.updateOne({ eventId, mode: this.mode, status: { $ne: "processed" } }, { $set: { status: "failed" } });
  }
  async pendingEvents(limit: number): Promise<EventRecord[]> {
    return EventModel.find({ mode: this.mode, status: { $ne: "processed" } }).sort({ lastAttemptAt: 1 }).limit(limit).lean().exec();
  }
  async accountsForReconciliation(limit: number): Promise<Account[]> {
    // Finished accounts are left to webhooks: re-reading them every minute only
    // burns Stripe rate limit. Deletions in progress are always retried.
    return AccountModel.find({ mode: this.mode, customerId: { $exists: true }, $or: [
      { status: { $nin: ["canceled", "incomplete_expired", "none"] } }, { deletedAt: { $ne: null } },
    ] }).sort({ updatedAt: 1 }).limit(limit).lean().exec();
  }
  async assertDeletionAllowed(userIds: string[]): Promise<void> {
    const pending = await AccountModel.exists({ userId: { $in: userIds }, $or: [
      { deletedAt: null }, { status: { $ne: "canceled" } },
    ] });
    if (pending) throw new BillingError("BILLING_DELETE_GUARD", "Cancela primero la facturación mediante el flujo de eliminación de cuenta.");
  }
}
