const mongoose = require("mongoose");
const routineAssignmentDao = require("./routine-assignment-dao");
const { coveringPhase } = require("../util/phase-chain");
const { startOfDayInZone, timeZoneOf, todayIsoDate } = require("../util/date-util");

// La rutina que un usuario tiene en uso (lo que entrena y lo que su
// entrenador ve como activa) y la sesión que tiene a medias. No se
// sincroniza: se calcula, así que aplicar, mover o quitar una fase nunca deja
// un puntero desfasado.
//
// - `User.tableInUse` + `tableInUseAt`: la última elección explícita (el
//   propio usuario, o su entrenador al activarle una de sus rutinas).
// - La fase de rutina que cubre hoy entra en vigor al empezar su día en la
//   zona del cliente, o al crearse si se crea ese mismo día o con fecha
//   pasada.
// - Manda lo más reciente: el cliente puede cambiar de rutina a mano y la
//   siguiente fase que empiece vuelve a mandar.
// - `workoutInUse` solo vale si se puso después de que la rutina en uso
//   entrara en vigor: una sesión a medias de otra rutina no se arrastra.

const time = (value) => (value ? new Date(value).getTime() : Number.NEGATIVE_INFINITY);

function phaseEffectiveAt(phase, timeZone) {
  return Math.max(startOfDayInZone(phase.startDate, timeZone).getTime(), time(phase.createdAt));
}

/**
 * Puro. `user` con tableInUse, tableInUseAt, workoutInUse, workoutInUseAt y
 * timezone; `phase`, la fase de rutina que cubre hoy (o null).
 * Devuelve { tableInUse, workoutInUse, phase } — `phase` solo si la rutina en
 * uso es la de esa fase.
 */
function resolveRoutineInUse(user, phase) {
  const chosenAt = user?.tableInUse ? time(user.tableInUseAt) : Number.NEGATIVE_INFINITY;
  const phaseAt = phase ? phaseEffectiveAt(phase, timeZoneOf(user)) : Number.NEGATIVE_INFINITY;
  const fromPhase = Boolean(phase) && phaseAt > chosenAt;
  const since = fromPhase ? phaseAt : chosenAt;
  const workoutValid = Boolean(user?.workoutInUse) && time(user.workoutInUseAt) >= since;
  const tableInUse = fromPhase ? phase.tableId : user?.tableInUse || null;
  return {
    tableInUse: tableInUse || null,
    workoutInUse: tableInUse && workoutValid ? user.workoutInUse : null,
    phase: fromPhase ? phase : null,
  };
}

const POINTER_FIELDS = "tableInUse tableInUseAt workoutInUse workoutInUseAt timezone";

// Para un usuario ya leído con sus punteros (POINTER_FIELDS).
async function routineInUseOf(user) {
  if (!user) return { tableInUse: null, workoutInUse: null, phase: null };
  const today = todayIsoDate(timeZoneOf(user));
  return resolveRoutineInUse(user, await routineAssignmentDao.findCoveringDate(user._id, today));
}

async function routineInUseOfId(userId) {
  return routineInUseOf(await mongoose.model("User").findById(userId).select(POINTER_FIELDS).lean());
}

// Para muchos usuarios a la vez (Cartera, alertas): dos consultas en total.
// Devuelve un Map por id de usuario.
async function routinesInUseOf(userIds) {
  if (!userIds?.length) return new Map();
  const [users, phasesByClient] = await Promise.all([
    mongoose.model("User").find({ _id: { $in: userIds } }).select(POINTER_FIELDS).lean(),
    routineAssignmentDao.listByClients(userIds),
  ]);
  return new Map(
    users.map((user) => {
      const today = todayIsoDate(timeZoneOf(user));
      const phase = coveringPhase(phasesByClient.get(String(user._id)) || [], today);
      return [String(user._id), resolveRoutineInUse(user, phase)];
    }),
  );
}

module.exports = { POINTER_FIELDS, resolveRoutineInUse, routineInUseOf, routineInUseOfId, routinesInUseOf };
