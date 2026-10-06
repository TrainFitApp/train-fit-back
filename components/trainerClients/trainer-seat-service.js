const trainerClientDao = require("./trainer-client-dao");
const userDao = require("../users/user-dao");
const featureAccess = require("../billing/feature-access");
const { badRequest, forbidden, conflict } = require("../util/http-error");
const { OPEN_STATUSES } = require("./pair-state");

// Plazas activas cuando el entrenador tiene más clientes que plazas contratadas:
// al volver a Free, al aplicarse una bajada o una reducción de plazas, tras un
// impago o al retirarse una subida. Decisiones de negocio 2026-09-18 y 2026-10-02:
// reducir nunca se bloquea y nada se borra ni se archiva; el entrenador elige qué
// clientes siguen activos y el resto queda en solo lectura (puede consultarlos,
// no modificarlos). Mientras no elija, se mantienen activos sus clientes más antiguos.
//
// Una plaza es un par con alguna invitación abierta (pendiente o en curso),
// tenga uno o dos scopes. Solo pueden quedar en solo lectura los que tienen
// cuenta (clientId): una invitación por email no tiene datos que congelar.
//
// Decisión 2026-09-18: la elección se puede cambiar una vez cada 30 días (la
// primera es libre); sin límite, rotar clientes a diario convertiría Free en un plan de pago.
const SEAT_CHANGE_COOLDOWN_MS = 30 * 86400000;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Antigüedad de una plaza: su invitación abierta más antigua.
function seatSince(pair) {
  return Math.min(
    ...pair.scopes.filter((link) => OPEN_STATUSES.includes(link.status)).map((link) => new Date(link.invitedAt).getTime())
  );
}

async function seatState(trainerId) {
  const user = await userDao.findFields(trainerId, "professionalPremium trainerSeats");
  const { seats: limit } = featureAccess.trainerPlan(user);
  const pairs = await trainerClientDao.findSeatPairs(trainerId);
  const usage = pairs.length;
  const candidates = pairs
    .filter((pair) => pair.clientId)
    .sort((a, b) => seatSince(a) - seatSince(b) || String(a._id).localeCompare(String(b._id)))
    .map((pair) => String(pair.clientId));
  const locked = user?.trainerSeats?.lockedUntil && new Date(user.trainerSeats.lockedUntil) > new Date()
    ? new Date(user.trainerSeats.lockedUntil) : null;
  if (candidates.length <= limit) {
    return { overLimit: false, limit, usage, candidates, active: new Set(candidates), autoSelected: false, lockedUntil: locked };
  }
  const chosen = (user?.trainerSeats?.clientIds || []).map(String)
    .filter((id, index, list) => candidates.includes(id) && list.indexOf(id) === index).slice(0, limit);
  const autoSelected = chosen.length < limit;
  for (const id of candidates) {
    if (chosen.length >= limit) break;
    if (!chosen.includes(id)) chosen.push(id);
  }
  return { overLimit: true, limit, usage, candidates, active: new Set(chosen), autoSelected, lockedUntil: locked };
}

async function isReadOnly(trainerId, clientId) {
  if (!clientId || String(trainerId) === String(clientId)) return false;
  const state = await seatState(trainerId);
  return state.overLimit && !state.active.has(String(clientId));
}

function readOnlyError(limit) {
  return {
    code: "CLIENT_READ_ONLY",
    message: `Este cliente está en solo lectura: tu plan admite ${limit} clientes activos. ` +
      "Cambia tus clientes activos desde Suscripción o mejora tu plan.",
  };
}

// Para controllers que resuelven la relación a mano: true si ya respondió 403.
async function rejectIfReadOnly(req, res, clientId) {
  if (READ_METHODS.has(req.method)) return false;
  const trainerId = req.auth?.userId;
  if (!trainerId || String(trainerId) === String(clientId)) return false;
  const state = await seatState(trainerId);
  if (!state.overLimit || state.active.has(String(clientId))) return false;
  res.status(403).send(readOnlyError(state.limit));
  return true;
}

async function listSeats(trainerId) {
  const state = await seatState(trainerId);
  const users = await userDao.listFields(state.candidates, "name lastname email");
  const byId = new Map(users.map((u) => [String(u._id), u]));
  return {
    overLimit: state.overLimit,
    limit: state.limit,
    usage: state.usage,
    autoSelected: state.autoSelected,
    lockedUntil: state.lockedUntil,
    clients: state.candidates.map((id) => {
      const user = byId.get(id);
      return { clientId: id, name: [user?.name, user?.lastname].filter(Boolean).join(" ") || null,
        email: user?.email || null, active: state.active.has(id) };
    }),
  };
}

async function setSeats(trainerId, clientIds) {
  if (!Array.isArray(clientIds) || clientIds.some((id) => typeof id !== "string")) {
    throw badRequest("Selecciona los clientes que seguirán activos.", "INVALID_SEATS");
  }
  const state = await seatState(trainerId);
  const unique = [...new Set(clientIds)];
  if (unique.some((id) => !state.candidates.includes(id))) {
    throw forbidden("Alguno de los clientes seleccionados no pertenece a tu cartera.", "SEAT_NOT_OWNED");
  }
  if (state.overLimit && unique.length > state.limit) {
    throw conflict(`Tu plan admite ${state.limit} clientes activos.`, "SEAT_LIMIT_EXCEEDED");
  }
  const current = [...state.active].sort().join();
  if (current === [...unique].sort().join()) return listSeats(trainerId);
  if (state.lockedUntil) {
    throw conflict(`Podrás cambiar tus clientes activos a partir del ${state.lockedUntil.toLocaleDateString("es-ES")}.`,
      "SEAT_CHANGE_LOCKED");
  }
  const now = new Date();
  await userDao.setTrainerSeats(trainerId, {
    clientIds: unique,
    updatedAt: now,
    lockedUntil: new Date(now.getTime() + SEAT_CHANGE_COOLDOWN_MS),
  });
  return listSeats(trainerId);
}

// Al aceptar una invitación: la persona pasa de reservar plaza a ocuparla. Si el entrenador ya
// redujo sus plazas y no queda ninguna libre, la invitación sigue pendiente (no se cancela) hasta
// que haya sitio. Quien ya ocupa plaza con otro scope no necesita otra. Se llama dentro del
// bloqueo de admisión del entrenador (trainerBilling/adapter.js#withClientAdmission).
async function assertSeatForAcceptance(trainerId, clientId, capacity) {
  const [seats, alreadyActive] = await Promise.all([
    trainerClientDao.countSeats(trainerId),
    trainerClientDao.isActivePair(trainerId, clientId),
  ]);
  if (alreadyActive || seats.occupied < capacity) return;
  throw conflict("Tu profesional no tiene ahora mismo una plaza libre. Pídele que amplíe sus plazas o vuelve a intentarlo más tarde.",
    "SEAT_UNAVAILABLE");
}

module.exports = { seatState, isReadOnly, rejectIfReadOnly, listSeats, setSeats, assertSeatForAcceptance, READ_METHODS };
