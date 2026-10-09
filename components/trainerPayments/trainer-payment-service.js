const mongoose = require("mongoose");
const { load: core } = require("./core");
const dao = require("./trainer-payment-dao");
const mapper = require("./trainer-payment-mapper");
const notificationDao = require("../notifications/notification-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { clientLedgerView } = require("./client-ledger-view");

// Orquestación del dominio de cobros: lee, pide al núcleo puro el estado
// siguiente y lo escribe con compare-and-swap. Ninguna regla de negocio vive
// aquí (están en src/*.ts); aquí solo el orden de lectura/escritura y los
// efectos secundarios (avisos resueltos, materialización).

const MAX_CAS_ATTEMPTS = 5;

function newId() {
  return new mongoose.Types.ObjectId().toHexString();
}

function paymentsError(code, message, status, details) {
  const { PaymentsError } = core();
  return new PaymentsError(code, message, status, details);
}

async function loadSettings(trainerId) {
  const doc = await dao.findSettings(trainerId);
  const defaults = core().DEFAULT_REMINDER_SETTINGS;
  if (!doc) return { timeZone: defaults.timeZone, time: defaults.time, offsets: [...defaults.offsets], revision: 0, persisted: false };
  return { timeZone: doc.timeZone, time: doc.time, offsets: doc.offsets || [], revision: doc.revision || 0, persisted: true };
}

// Mismo "hoy" para avisos, ficha, tarjeta y global: el de la zona guardada del
// entrenador, nunca el del servidor ni el del dispositivo.
function makeContext(settings, actorId, now = new Date()) {
  return { now, today: core().civilDayInZone(now, settings.timeZone), actorId: actorId ? String(actorId) : null, newId };
}

function normalize(doc) {
  return core().normalizeCharge(mapper.toChargeRecord(doc));
}

function sortViews(views) {
  const group = { overdue: 0, due_today: 1, upcoming: 2, closed: 3 };
  return views.sort((a, b) => {
    const byGroup = group[a.temporal] - group[b.temporal];
    if (byGroup) return byGroup;
    if (a.dueDay === b.dueDay) return a.id < b.id ? -1 : 1;
    const asc = a.dueDay < b.dueDay ? -1 : 1;
    return a.temporal === "closed" ? -asc : asc;
  });
}

// --- Efectos tras escribir un cobro ------------------------------------------

async function afterChargeWrite(before, after, ctx) {
  try {
    if (before.status === "open" && after.status !== "open") {
      await notificationDao.resolvePaymentNotifications(after.trainerId, after.id, after.status, { now: ctx.now });
    }
    if (before.persistedV2 && after.dueRevision > before.dueRevision) {
      await notificationDao.resolvePaymentNotifications(after.trainerId, after.id, "rescheduled", {
        beforeDueRevision: after.dueRevision,
        now: ctx.now,
      });
    }
  } catch (error) {
    // El cobro ya está guardado; la lectura de avisos añade el estado vigente igualmente.
    console.error("[TrainerPayments] No se pudieron resolver avisos del cobro", after.id, error.message);
  }
}

async function mutateCharge(trainerId, clientId, chargeId, actorId, compute) {
  const settings = await loadSettings(trainerId);
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const doc = await dao.findCharge(trainerId, clientId, chargeId);
    if (!doc) throw paymentsError("CHARGE_NOT_FOUND", "Cobro no encontrado.", 404);
    const before = normalize(doc);
    const ctx = makeContext(settings, actorId);
    const result = compute(before, ctx);
    if (result.kind === "replay" || result.kind === "noop") return { ...result, before, after: result.charge || before, ctx };
    if (await dao.casWrite(before, result.charge)) {
      await afterChargeWrite(before, result.charge, ctx);
      return { ...result, before, after: result.charge, ctx };
    }
  }
  throw paymentsError("CONCURRENT_UPDATE", "El cobro ha cambiado mientras se guardaba. Vuelve a intentarlo.", 409);
}

// --- Cuota: materialización y reconciliación -----------------------------------

// `openRecurring`: los recurrentes abiertos de la pareja ya leídos (al poner
// al día todas las cuotas de un usuario se leen de una vez, no uno por cuota).
async function reconcileProfile(profile, ctx, openRecurring = null) {
  const stats = { inserted: 0, voided: 0, repriced: 0 };
  if (!profile.id || !profile.plan) return stats;
  const C = core();
  const targets = C.materializationTargets(profile, ctx.today);
  if (targets.length) {
    const existing = await dao.existingOccurrenceKeys(targets.map((target) => target.key));
    const docs = targets
      .filter((target) => !existing.has(target.key))
      .map((target) => mapper.newChargeDoc(C.newRecurringCharge(profile, target, newId(), ctx.now)));
    stats.inserted = (await dao.insertCharges(docs)).inserted;
    await dao.advanceCursor(profile.id, profile.plan.segment, targets[targets.length - 1].day);
  }
  const candidates =
    openRecurring || (await dao.listOpenRecurring({ trainerId: profile.trainerId, clientId: profile.clientId }, ctx.today)).map(normalize);
  const result = C.reconcileCharges(profile, candidates, ctx.today, ctx);
  for (const voided of result.voids) {
    const before = candidates.find((charge) => charge.id === voided.id);
    if (await dao.casWrite(before, voided)) {
      stats.voided += 1;
      await afterChargeWrite(before, voided, ctx);
    }
  }
  for (const { before, after } of result.reprices) {
    if (await dao.casWrite(before, after)) stats.repriced += 1;
  }
  return stats;
}

// Fin de relación: sin nuevas cuotas y sin avisos al cliente. La deuda y el
// historial se quedan; el entrenador los sigue viendo y puede cerrarlos.
function endForRelation(profile, ctx) {
  const ended = core().endPlan(profile, null, "relation_ended", ctx);
  const reminders = profile.clientReminders.enabled
    ? { ...profile.clientReminders, enabled: false, disabledAt: ctx.now, disabledReason: "relation_ended" }
    : profile.clientReminders;
  const changed = ended.mode !== "noop" || reminders !== profile.clientReminders;
  return changed
    ? { mode: "update", profile: { ...ended.profile, clientReminders: reminders, revision: profile.revision + 1 } }
    : { mode: "noop", profile };
}

async function withProfile(trainerId, clientId, actorId, compute, { create = false, settings = null, now = null } = {}) {
  const resolvedSettings = settings || (await loadSettings(trainerId));
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const doc = create ? await dao.ensureProfile(trainerId, clientId) : await dao.findProfile(trainerId, clientId);
    const profile = mapper.toProfile(doc, trainerId, clientId);
    const ctx = makeContext(resolvedSettings, actorId, now || new Date());
    const charges = profile.id ? (await dao.listClientCharges(trainerId, clientId)).map(normalize) : [];
    const change = compute(profile, charges, ctx);
    if (change.mode === "replay" || change.mode === "noop") return { change, profile, charges, ctx, settings: resolvedSettings };
    if (await dao.casWriteProfile(profile, change.profile)) {
      await reconcileProfile(change.profile, ctx);
      return { change, profile: change.profile, charges, ctx, settings: resolvedSettings };
    }
  }
  throw paymentsError("CONCURRENT_UPDATE", "La cuota ha cambiado mientras se guardaba. Vuelve a intentarlo.", 409);
}

async function hasActiveRelation(trainerId, clientId) {
  return trainerClientDao.isActivePair(trainerId, clientId);
}

// Llamado al revocar un scope (y, como red de seguridad, al poner al día los
// cobros: trainer-payment-reminder-service.js). Solo si ya no queda NINGÚN
// scope activo con este entrenador termina la cuota.
async function onRelationChanged(trainerId, clientId, { now = null } = {}) {
  if (await hasActiveRelation(trainerId, clientId)) return { ended: false };
  const doc = await dao.findProfile(trainerId, clientId);
  if (!doc) return { ended: false };
  const { change } = await withProfile(trainerId, clientId, null, (profile, _charges, ctx) => endForRelation(profile, ctx), { now });
  return { ended: change.mode !== "noop" };
}

// Lectura con la cuota al día: materializa lo pendiente de ESTA pareja y, para
// un antiguo cliente, cierra la cuota si seguía viva.
async function syncProfile(trainerId, clientId, access, settings) {
  const doc = await dao.findProfile(trainerId, clientId);
  let profile = mapper.toProfile(doc, trainerId, clientId);
  const ctx = makeContext(settings, trainerId);
  if (!profile.id) return { profile, ctx };
  const stale = profile.plan?.status !== "ended" && Boolean(profile.plan);
  if ((access === "former" && (stale || profile.clientReminders.enabled))) {
    const result = await withProfile(trainerId, clientId, null, (current, _charges, innerCtx) => endForRelation(current, innerCtx), { settings });
    profile = result.profile;
  } else if (profile.plan) {
    await reconcileProfile(profile, ctx);
  }
  return { profile, ctx };
}

function preferencesView(profile, settings) {
  return {
    clientRemindersEnabled: profile.clientReminders.enabled,
    clientRemindersEnabledAt: profile.clientReminders.enabledAt,
    clientRemindersDisabledReason: profile.clientReminders.disabledReason,
    reminderOffsets: profile.reminderOffsets,
    inheritedOffsets: settings.offsets,
  };
}

// --- Lecturas por cliente ---------------------------------------------------------

async function getClientLedger(trainerId, clientId, access) {
  const C = core();
  const settings = await loadSettings(trainerId);
  const { profile, ctx } = await syncProfile(trainerId, clientId, access, settings);
  const charges = (await dao.listClientCharges(trainerId, clientId)).map(normalize);
  const live = charges.filter((charge) => charge.status !== "void");
  return {
    access,
    today: ctx.today,
    timeZone: settings.timeZone,
    plan: C.planView(profile.plan, ctx.today),
    preferences: preferencesView(profile, settings),
    summary: C.clientPaymentsSummary(charges, profile.plan, ctx.today),
    charges: sortViews(live.map((charge) => C.chargeView(charge, ctx.today))),
    voided: charges.filter((charge) => charge.status === "void").map((charge) => C.chargeView(charge, ctx.today)),
  };
}

async function getClientSummary(trainerId, clientId, access) {
  const C = core();
  const settings = await loadSettings(trainerId);
  const { profile, ctx } = await syncProfile(trainerId, clientId, access, settings);
  const charges = (await dao.listClientCharges(trainerId, clientId)).map(normalize);
  return { access, today: ctx.today, summary: C.clientPaymentsSummary(charges, profile.plan, ctx.today) };
}

async function getChargeDetail(trainerId, clientId, chargeId) {
  const settings = await loadSettings(trainerId);
  const doc = await dao.findCharge(trainerId, clientId, chargeId);
  if (!doc) throw paymentsError("CHARGE_NOT_FOUND", "Cobro no encontrado.", 404);
  const ctx = makeContext(settings, trainerId);
  return core().chargeDetailView(normalize(doc), ctx.today);
}

// --- Cobros puntuales ------------------------------------------------------------------

async function notifyChargeCreated(charge, ctx) {
  try {
    if (charge.dueDay < ctx.today) return; // deuda anterior: sin avisos retroactivos
    const profile = await dao.findProfile(charge.trainerId, charge.clientId);
    if (!profile?.clientReminders?.enabled) return;
    if (!(await hasActiveRelation(charge.trainerId, charge.clientId))) return;
    await notificationDao.createIdempotent({
      clientId: charge.clientId,
      trainerId: charge.trainerId,
      recipient: "client",
      type: "payment_created",
      // Nunca la nota privada.
      payload: {
        chargeId: charge.id,
        amountCents: charge.amountCents,
        currency: charge.currency,
        dueDay: charge.dueDay,
        concept: charge.concept,
      },
      dedupeKey: `paycreated:${charge.id}`,
      createdAt: ctx.now,
    });
  } catch (error) {
    console.error("[TrainerPayments] No se pudo crear el aviso de cobro nuevo", error.message);
  }
}

function replayCreate(doc, hash, today) {
  if (doc.createPayloadHash !== hash) {
    throw paymentsError("IDEMPOTENCY_CONFLICT", "Esta operación ya se registró con otros datos.", 409);
  }
  return { replay: true, charge: core().chargeDetailView(normalize(doc), today) };
}

async function createOneOffCharge(trainerId, clientId, body, actorId) {
  const C = core();
  const settings = await loadSettings(trainerId);
  const ctx = makeContext(settings, actorId);
  const created = C.newOneOffCharge(body || {}, { id: newId(), trainerId: String(trainerId), clientId: String(clientId) }, ctx);
  const existing = await dao.findByCreateOperation(trainerId, created.operationId);
  if (existing) return replayCreate(existing, created.payloadHash, ctx.today);
  try {
    await dao.createCharge(
      mapper.newChargeDoc(created.charge, { createOperationId: created.operationId, createPayloadHash: created.payloadHash })
    );
  } catch (error) {
    if (error.code !== dao.DUPLICATE_KEY) throw error;
    const again = await dao.findByCreateOperation(trainerId, created.operationId);
    if (again) return replayCreate(again, created.payloadHash, ctx.today);
    throw error;
  }
  await notifyChargeCreated(created.charge, ctx);
  return { replay: false, charge: C.chargeDetailView(created.charge, ctx.today) };
}

// --- Operaciones sobre un cobro --------------------------------------------------------

async function registerPayment(trainerId, clientId, chargeId, body, actorId) {
  const C = core();
  const input = C.parsePaymentBody(body || {});
  const result = await mutateCharge(trainerId, clientId, chargeId, actorId, (charge, ctx) => C.registerPayment(charge, input, ctx));
  return { replay: result.kind === "replay", movementId: result.movement.id, charge: C.chargeDetailView(result.after, result.ctx.today) };
}

async function correctPayment(trainerId, clientId, chargeId, paymentId, body, actorId) {
  const C = core();
  const result = await mutateCharge(trainerId, clientId, chargeId, actorId, (charge, ctx) =>
    C.correctPayment(charge, String(paymentId), body || {}, ctx)
  );
  return { replay: result.kind === "replay", reopened: Boolean(result.reopened), charge: C.chargeDetailView(result.after, result.ctx.today) };
}

async function cancelBalance(trainerId, clientId, chargeId, body, actorId) {
  const C = core();
  const result = await mutateCharge(trainerId, clientId, chargeId, actorId, (charge, ctx) => C.cancelBalance(charge, body || {}, ctx));
  return { replay: result.kind === "replay", charge: C.chargeDetailView(result.after, result.ctx.today) };
}

async function restoreCancelled(trainerId, clientId, chargeId, body, actorId) {
  const C = core();
  const result = await mutateCharge(trainerId, clientId, chargeId, actorId, (charge, ctx) => C.restoreCancelled(charge, body || {}, ctx));
  return { replay: result.kind === "replay", reopened: Boolean(result.reopened), charge: C.chargeDetailView(result.after, result.ctx.today) };
}

async function editCharge(trainerId, clientId, chargeId, body, actorId) {
  const C = core();
  const result = await mutateCharge(trainerId, clientId, chargeId, actorId, (charge, ctx) => C.editCharge(charge, body || {}, ctx));
  return { replay: result.kind === "replay", reopened: Boolean(result.reopened), charge: C.chargeDetailView(result.after, result.ctx.today) };
}

// --- Cuota -----------------------------------------------------------------------------------

function planEffects(change, charges, ctx) {
  const C = core();
  if (!change.profile.plan) return { updates: [], voids: [], protected: [] };
  const open = charges.filter((charge) => charge.status === "open");
  const probe = C.reconcileCharges(change.profile, open, ctx.today, ctx);
  return {
    updates: probe.reprices.map(({ before, after }) => ({
      chargeId: before.id,
      dueDay: before.dueDay,
      fromCents: before.amountCents,
      toCents: after.amountCents,
    })),
    voids: probe.voids.map((charge) => ({ chargeId: charge.id, dueDay: charge.dueDay, amountCents: charge.amountCents, reason: charge.voidReason })),
    protected: probe.protectedCharges,
  };
}

function planResponse(result) {
  const C = core();
  return {
    mode: result.change.mode,
    changes: result.change.changes || [],
    priceFromDay: result.change.priceFromDay || null,
    nextDates: result.change.nextDates || [],
    plan: C.planView(result.profile.plan, result.ctx.today),
    preferences: preferencesView(result.profile, result.settings),
  };
}

async function previewPlan(trainerId, clientId, body) {
  const C = core();
  const settings = await loadSettings(trainerId);
  const profile = mapper.toProfile(await dao.findProfile(trainerId, clientId), trainerId, clientId);
  const ctx = makeContext(settings, trainerId);
  const charges = profile.id ? (await dao.listClientCharges(trainerId, clientId)).map(normalize) : [];
  // El operationId de la vista previa no se registra: solo se calcula.
  const change = C.planChange(profile, charges, { ...(body || {}), operationId: body?.operationId || `preview-${newId()}` }, ctx);
  return {
    mode: change.mode,
    changes: change.changes,
    priceFromDay: change.priceFromDay,
    nextDates: change.nextDates,
    effects: planEffects(change, charges, ctx),
  };
}

async function savePlan(trainerId, clientId, body, actorId) {
  const C = core();
  const result = await withProfile(trainerId, clientId, actorId, (profile, charges, ctx) => C.planChange(profile, charges, body || {}, ctx), {
    create: true,
  });
  return planResponse(result);
}

async function pausePlan(trainerId, clientId, body, actorId) {
  const C = core();
  const result = await withProfile(trainerId, clientId, actorId, (profile, _charges, ctx) => C.pausePlan(profile, body || {}, ctx));
  return planResponse(result);
}

async function resumePlan(trainerId, clientId, body, actorId) {
  const C = core();
  const result = await withProfile(trainerId, clientId, actorId, (profile, charges, ctx) => C.resumePlan(profile, charges, body || {}, ctx));
  return planResponse(result);
}

async function endPlan(trainerId, clientId, body, actorId) {
  const C = core();
  const result = await withProfile(trainerId, clientId, actorId, (profile, _charges, ctx) => C.endPlan(profile, body || {}, "trainer", ctx));
  return planResponse(result);
}

// Activar avisos del cliente no envía el histórico: su ventana empieza ahora.
async function setPreferences(trainerId, clientId, body, actorId, access) {
  const C = core();
  const enabled = body?.clientRemindersEnabled;
  if (typeof enabled !== "boolean") {
    throw paymentsError("INVALID_PREFERENCES", "Indica si el cliente recibe avisos (sí/no).", 400);
  }
  if (enabled && access !== "active") {
    throw paymentsError("FORMER_CLIENT_RESTRICTED", "Un antiguo cliente no recibe avisos.", 403);
  }
  const offsets = body.reminderOffsets === undefined ? undefined : body.reminderOffsets === null ? null : C.parseOffsets(body.reminderOffsets);
  const result = await withProfile(
    trainerId,
    clientId,
    actorId,
    (profile, _charges, ctx) => {
      let reminders = profile.clientReminders;
      if (enabled && !reminders.enabled) reminders = { enabled: true, enabledAt: ctx.now, disabledAt: null, disabledReason: null };
      if (!enabled && reminders.enabled) reminders = { ...reminders, enabled: false, disabledAt: ctx.now, disabledReason: "trainer" };
      const nextOffsets = offsets === undefined ? profile.reminderOffsets : offsets;
      const same = reminders === profile.clientReminders && JSON.stringify(nextOffsets) === JSON.stringify(profile.reminderOffsets);
      return same
        ? { mode: "noop", profile }
        : { mode: "update", profile: { ...profile, clientReminders: reminders, reminderOffsets: nextOffsets, revision: profile.revision + 1 } };
    },
    { create: true }
  );
  return preferencesView(result.profile, result.settings);
}

// --- Lecturas de otros componentes ----------------------------------------------------------

// Coach del cliente: saldo restante de sus cobros con profesionales activos.
async function listCoachPending(clientId, activeTrainerIds, trainerNameFor) {
  const C = core();
  const docs = await dao.listOpenForClient(clientId, activeTrainerIds);
  const open = docs.map(normalize).filter((charge) => charge.status === "open" && C.balanceOf(charge) > 0);
  return {
    items: open.map((charge) => C.coachPendingItem(charge, trainerNameFor(charge.trainerId))),
    activity: open.map((charge) => ({ trainerId: charge.trainerId, at: charge.createdAt })),
  };
}

// Coach del cliente: lo que le cobra UN profesional con relación activa (la
// comprueba quien llama). Solo lectura: las cuotas que ya tocan las pone al
// día antes el que llama (trainer-payment-reminder-service.js#ensureClientUpToDate).
async function getLedgerForClient(trainerId, clientId) {
  const C = core();
  const settings = await loadSettings(trainerId);
  const ctx = makeContext(settings, null);
  const profile = mapper.toProfile(await dao.findProfile(trainerId, clientId), trainerId, clientId);
  const charges = (await dao.listClientCharges(trainerId, clientId)).map(normalize);
  return clientLedgerView({
    today: ctx.today,
    plan: C.planView(profile.plan, ctx.today),
    summary: C.clientPaymentsSummary(charges, profile.plan, ctx.today),
    charges: sortViews(charges.map((charge) => C.chargeDetailView(charge, ctx.today))),
  });
}

// Un aviso antiguo se pinta con el saldo de AHORA (o como histórico si el
// cobro ya se cerró), nunca con el importe que tenía al emitirse.
async function enrichNotifications(notifications, audience, trainerId = null) {
  const targets = notifications.filter(
    (item) => (item.type === "payment_reminder" || item.type === "payment_created") && item.payload?.chargeId
  );
  if (!targets.length) return notifications;
  const C = core();
  const docs = await dao.listChargesByIds([...new Set(targets.map((item) => String(item.payload.chargeId)))]);
  const byId = new Map(docs.map((doc) => [String(doc._id), normalize(doc)]));
  let activeClients = null;
  if (audience === "trainer" && trainerId) {
    const clientIds = [...new Set(targets.map((item) => String(item.clientId)))];
    activeClients = await trainerClientDao.findActiveClientIds(trainerId, { clientIds });
  }
  return notifications.map((item) => {
    const charge = item.payload?.chargeId ? byId.get(String(item.payload.chargeId)) : null;
    if (!charge) return item;
    const current = C.notificationChargeState(charge);
    if (activeClients) current.clientRelation = activeClients.has(String(item.clientId)) ? "active" : "former";
    return { ...item, payload: { ...item.payload, current } };
  });
}

module.exports = {
  loadSettings,
  makeContext,
  normalize,
  reconcileProfile,
  endForRelation,
  onRelationChanged,
  getClientLedger,
  getClientSummary,
  getChargeDetail,
  createOneOffCharge,
  registerPayment,
  correctPayment,
  cancelBalance,
  restoreCancelled,
  editCharge,
  previewPlan,
  savePlan,
  pausePlan,
  resumePlan,
  endPlan,
  setPreferences,
  listCoachPending,
  getLedgerForClient,
  enrichNotifications,
  afterChargeWrite,
};
