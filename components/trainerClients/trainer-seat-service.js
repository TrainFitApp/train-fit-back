const TrainerClient = require("./trainer-client-schema");
const User = require("../users/schema");
const featureAccess = require("../billing/feature-access-service");

// Plazas activas cuando el entrenador tiene más clientes que plazas contratadas:
// al volver a Free, al aplicarse una bajada o una reducción de plazas, tras un
// impago o al retirarse una subida. Decisiones de negocio 2026-09-18 y 2026-10-02:
// reducir nunca se bloquea y nada se borra ni se archiva; el entrenador elige qué
// clientes siguen activos y el resto queda en solo lectura (puede consultarlos,
// no modificarlos). Mientras no elija, se mantienen activos sus clientes más antiguos.
//
// Solo cuentan como plaza los clientes con cuenta (clientId). Las invitaciones
// pendientes por email ocupan cupo para nuevas altas pero no tienen datos que
// congelar: se resuelven cancelándolas.
const BILLABLE_STATUSES = ["pending", "cuestionario_pendiente", "en_revision", "active"];
// Ocupan plaza quienes ya aceptaron; una invitación pendiente solo la reserva.
const OCCUPYING_STATUSES = ["cuestionario_pendiente", "en_revision", "active"];
// Decisión 2026-09-18: la elección se puede cambiar una vez cada 30 días (la
// primera es libre); sin límite, rotar clientes a diario convertiría Free en un plan de pago.
const SEAT_CHANGE_COOLDOWN_MS = 30 * 86400000;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function billableKeys(relations) {
  return require("../../.build/trainer-billing/usage").billableClientKeys(relations);
}

async function seatState(trainerId) {
  const user = await User.findById(trainerId).select("professionalPremium trainerSeats").lean();
  const { seats: limit } = featureAccess.trainerPlan(user);
  const relations = await TrainerClient.find({ trainerId, status: { $in: BILLABLE_STATUSES } })
    .select("clientId clientEmail invitedAt").sort({ invitedAt: 1, _id: 1 }).lean();
  const usage = billableKeys(relations).size;
  const candidates = [...new Set(relations.filter((r) => r.clientId).map((r) => String(r.clientId)))];
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
  const users = await User.find({ _id: { $in: state.candidates } }).select("name lastname email").lean();
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
    const error = new Error("Selecciona los clientes que seguirán activos.");
    error.status = 400;
    error.code = "INVALID_SEATS";
    throw error;
  }
  const state = await seatState(trainerId);
  const unique = [...new Set(clientIds)];
  if (unique.some((id) => !state.candidates.includes(id))) {
    const error = new Error("Alguno de los clientes seleccionados no pertenece a tu cartera.");
    error.status = 403;
    error.code = "SEAT_NOT_OWNED";
    throw error;
  }
  if (state.overLimit && unique.length > state.limit) {
    const error = new Error(`Tu plan admite ${state.limit} clientes activos.`);
    error.status = 409;
    error.code = "SEAT_LIMIT_EXCEEDED";
    throw error;
  }
  const current = [...state.active].sort().join();
  if (current === [...unique].sort().join()) return listSeats(trainerId);
  if (state.lockedUntil) {
    const error = new Error(`Podrás cambiar tus clientes activos a partir del ${state.lockedUntil.toLocaleDateString("es-ES")}.`);
    error.status = 409;
    error.code = "SEAT_CHANGE_LOCKED";
    throw error;
  }
  const now = new Date();
  await User.updateOne({ _id: trainerId }, { $set: { trainerSeats: { clientIds: unique, updatedAt: now,
    lockedUntil: new Date(now.getTime() + SEAT_CHANGE_COOLDOWN_MS) } } });
  return listSeats(trainerId);
}

// Al aceptar una invitación: la persona pasa de reservar plaza a ocuparla. Si el entrenador ya
// redujo sus plazas y no queda ninguna libre, la invitación sigue pendiente (no se cancela) hasta
// que haya sitio. Quien ya ocupa plaza con otro scope no necesita otra. Se llama dentro del
// bloqueo de admisión del entrenador (trainerBilling/adapter.js#withClientAdmission).
async function assertSeatForAcceptance(trainerId, clientId, capacity) {
  const relations = await TrainerClient.find({ trainerId, status: { $in: OCCUPYING_STATUSES } })
    .select("clientId clientEmail").lean();
  const keys = billableKeys(relations);
  if (keys.has(`id:${clientId}`) || keys.size < capacity) return;
  const error = new Error("Tu profesional no tiene ahora mismo una plaza libre. Pídele que amplíe sus plazas o vuelve a intentarlo más tarde.");
  error.status = 409;
  error.code = "SEAT_UNAVAILABLE";
  throw error;
}

module.exports = { seatState, isReadOnly, rejectIfReadOnly, listSeats, setSeats, assertSeatForAcceptance, READ_METHODS,
  BILLABLE_STATUSES };
