const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../users/user-schema");
const trainerClientDao = require("./trainer-client-dao");
const seats = require("./trainer-seat-service");

// Sin MongoDB: se sustituyen las lecturas del usuario y del DAO de pares.
const TRAINER = "64b000000000000000000001";
const id = (n) => `64b0000000000000000001${String(n).padStart(2, "0")}`;
let user;
let relations;
let saved;
const chain = (value) => ({ select: () => chain(value), sort: () => chain(value), lean: async () => value });
User.findById = () => chain(user);
User.find = () => chain(relations.filter((r) => r.clientId).map((r) => ({ _id: r.clientId, name: `C${r.clientId.slice(-2)}` })));
User.updateOne = async (_filter, update) => { saved = update.$set.trainerSeats; user.trainerSeats = saved; };
// Una relación de la prueba = un par con una invitación: en curso si ya
// tiene cuenta (clientId), pendiente si solo es un email.
const pairOf = (r) => ({ _id: r.clientId || r.clientEmail, clientId: r.clientId, clientEmail: r.clientEmail,
  scopes: [{ scope: "training", status: r.clientId ? "active" : "pending", invitedAt: r.invitedAt }] });
trainerClientDao.findSeatPairs = async () => relations.map(pairOf);
trainerClientDao.countSeats = async () => {
  const occupied = relations.filter((r) => r.clientId).length;
  return { occupied, reserved: relations.length - occupied };
};
trainerClientDao.isActivePair = async (_trainerId, clientId) => relations.some((r) => r.clientId === clientId);

const free = () => ({ professionalPremium: { entitled: false } });
const rel = (n, extra = {}) => ({ clientId: id(n), clientEmail: `c${n}@t.test`, invitedAt: new Date(2026, 0, n), ...extra });
function reset(count, extra = {}) {
  user = { ...free(), ...extra };
  relations = Array.from({ length: count }, (_, i) => rel(i + 1));
  saved = undefined;
}
const fakeRes = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; } });

test("within the plan quota nobody is read-only", async () => {
  reset(3);
  const state = await seats.seatState(TRAINER);
  assert.equal(state.overLimit, false);
  assert.equal(await seats.isReadOnly(TRAINER, id(3)), false);
});

test("over the Free quota without a choice keeps the three oldest clients active", async () => {
  reset(5);
  const state = await seats.seatState(TRAINER);
  assert.equal(state.overLimit, true);
  assert.equal(state.limit, 3);
  assert.equal(state.autoSelected, true);
  assert.deepEqual([...state.active], [id(1), id(2), id(3)]);
  assert.equal(await seats.isReadOnly(TRAINER, id(5)), true);
});

test("an explicit choice is honoured; stale ids are ignored and the gap is filled", async () => {
  reset(5, { trainerSeats: { clientIds: [id(5), id(4), "64b0000000000000000009999"] } });
  const state = await seats.seatState(TRAINER);
  assert.deepEqual([...state.active], [id(5), id(4), id(1)]);
  assert.equal(state.autoSelected, true, "only two valid choices out of three");
});

test("pending e-mail invitations use quota but never freeze a client with data", async () => {
  reset(3);
  relations.push({ clientEmail: "pending@t.test", invitedAt: new Date(2026, 1, 1) });
  const state = await seats.seatState(TRAINER);
  assert.equal(state.usage, 4);
  assert.equal(state.overLimit, false);
});

test("read-only clients can be read but not modified; the trainer's own id is never blocked", async () => {
  reset(5);
  const read = fakeRes();
  assert.equal(await seats.rejectIfReadOnly({ method: "GET", auth: { userId: TRAINER } }, read, id(5)), false);
  const write = fakeRes();
  assert.equal(await seats.rejectIfReadOnly({ method: "POST", auth: { userId: TRAINER } }, write, id(5)), true);
  assert.equal(write.statusCode, 403);
  assert.equal(write.body.code, "CLIENT_READ_ONLY");
  const active = fakeRes();
  assert.equal(await seats.rejectIfReadOnly({ method: "PUT", auth: { userId: TRAINER } }, active, id(1)), false);
  assert.equal(await seats.rejectIfReadOnly({ method: "PUT", auth: { userId: TRAINER } }, fakeRes(), TRAINER), false);
});

test("las plazas contratadas mandan: con 5 clientes y 4 plazas uno queda en solo lectura", async () => {
  const paid = (seatCount) => ({ professionalPremium: { entitled: true, tier: "free", interval: "monthly", seats: seatCount,
    expiresAt: new Date(Date.now() + 86400000) } });
  reset(5, paid(25));
  assert.equal((await seats.seatState(TRAINER)).overLimit, false);
  reset(5, paid(4));
  const state = await seats.seatState(TRAINER);
  assert.equal(state.limit, 4);
  assert.deepEqual([...state.active], [id(1), id(2), id(3), id(4)]);
  assert.equal(await seats.isReadOnly(TRAINER, id(5)), true);
});

test("aceptar una invitación necesita una plaza libre entre los que ya aceptaron, salvo que ya ocupe una", async () => {
  reset(3);
  await assert.doesNotReject(seats.assertSeatForAcceptance(TRAINER, id(9), 4));
  await assert.rejects(seats.assertSeatForAcceptance(TRAINER, id(9), 3), (e) => e.code === "SEAT_UNAVAILABLE" && e.status === 409);
  await assert.doesNotReject(seats.assertSeatForAcceptance(TRAINER, id(2), 3), "el otro scope de quien ya ocupa plaza");
});

test("choosing seats validates ownership and the plan quota", async () => {
  reset(5);
  await assert.rejects(seats.setSeats(TRAINER, [id(1), id(2), id(3), id(4)]), (e) => e.code === "SEAT_LIMIT_EXCEEDED");
  await assert.rejects(seats.setSeats(TRAINER, ["64b0000000000000000009999"]), (e) => e.code === "SEAT_NOT_OWNED");
  await assert.rejects(seats.setSeats(TRAINER, "nope"), (e) => e.code === "INVALID_SEATS");
  const result = await seats.setSeats(TRAINER, [id(4), id(5), id(1)]);
  assert.deepEqual(saved.clientIds, [id(4), id(5), id(1)]);
  assert.equal(result.autoSelected, false);
  assert.deepEqual(result.clients.filter((c) => c.active).map((c) => c.clientId).sort(), [id(1), id(4), id(5)].sort());
});

test("the first choice is free; changing it again is locked for 30 days, re-saving the same set is harmless", async () => {
  reset(5);
  const first = await seats.setSeats(TRAINER, [id(1), id(2), id(5)]);
  const days = (new Date(first.lockedUntil) - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30);
  saved = undefined;
  await seats.setSeats(TRAINER, [id(5), id(2), id(1)]);
  assert.equal(saved, undefined, "same selection in another order is a no-op");
  await assert.rejects(seats.setSeats(TRAINER, [id(1), id(2), id(3)]), (e) => e.code === "SEAT_CHANGE_LOCKED");
  user.trainerSeats.lockedUntil = new Date(Date.now() - 1000);
  await seats.setSeats(TRAINER, [id(1), id(2), id(3)]);
  assert.deepEqual(saved.clientIds, [id(1), id(2), id(3)]);
});
