// Cadenas de fases sin estado guardado y rutina en uso calculada (2026-10,
// docs/refactor-modelo-datos-estado.md E2).
//
// Antes:  dietphases y routineassignments guardaban `status` ("active" |
//         "superseded" | "ended") y `supersededBy`; las de rutina, además,
//         `activatedAt`, y users.tableInUse/workoutInUse era un puntero que se
//         reescribía al aplicar, quitar o "activar" (al leer) una fase.
// Ahora:  la cadena sale de las fechas (components/util/phase-chain.js) y la
//         rutina en uso se calcula (routineAssignments/routine-in-use.js):
//         users.tableInUse(+At) es solo la última ELECCIÓN explícita.
//
// Usuarios con puntero, según la fase de rutina que les cubre hoy (en su zona):
// - Fase pendiente de activar (activatedAt null): la vieja app la habría puesto
//   en uso en la siguiente lectura. Fuera la elección y la sesión a medias
//   (era de la rutina anterior): manda la fase.
// - El puntero es la tabla de esa fase: no era una elección, era la fase.
//   Fuera la elección; la sesión a medias se conserva (workoutInUseAt ahora).
// - Otro puntero (lo eligió después de que la fase entrara en vigor), o sin
//   fase: es una elección, con fecha de ahora (cualquier fase que empiece
//   después le gana, como antes).
// Después: fuera status/supersededBy/activatedAt y los índices por status.
// Idempotente: la segunda pasada no encuentra nada.

const { timeZoneOf, todayIsoDate } = require("../../components/util/date-util");

const OLD_INDEXES = {
  dietphases: ["clientId_1_status_1", "clientId_1_startDate_-1"],
  routineassignments: ["clientId_1_status_1_startDate_1", "clientId_1", "status_1"],
};

// La fase que cubre `today` entre las de un cliente (orden de la cadena).
function covering(phases, today) {
  return (
    phases
      .filter((phase) => phase.startDate <= today)
      .sort((a, b) => b.startDate.localeCompare(a.startDate) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] ||
    null
  );
}

async function migratePhaseChains(db, { dryRun = false, now = new Date() } = {}) {
  const users = db.collection("users");
  const routines = db.collection("routineassignments");
  const dietPhases = db.collection("dietphases");

  const stats = {
    dryRun,
    pendingActivation: 0,
    pointerWasPhase: 0,
    choices: 0,
    workoutsKept: 0,
    routineStateFields: await routines.countDocuments({
      $or: [{ status: { $exists: true } }, { supersededBy: { $exists: true } }, { activatedAt: { $exists: true } }],
    }),
    dietStateFields: await dietPhases.countDocuments({ $or: [{ status: { $exists: true } }, { supersededBy: { $exists: true } }] }),
    droppedIndexes: [],
  };

  const pointerUsers = await users
    .find(
      {
        $or: [
          { tableInUse: { $exists: true, $ne: null }, tableInUseAt: { $exists: false } },
          { workoutInUse: { $exists: true, $ne: null }, workoutInUseAt: { $exists: false } },
        ],
      },
      { projection: { tableInUse: 1, workoutInUse: 1, timezone: 1 } }
    )
    .toArray();

  const phasesByClient = new Map();
  if (pointerUsers.length) {
    const phases = await routines.find({ clientId: { $in: pointerUsers.map((user) => user._id) } }).toArray();
    for (const phase of phases) {
      const key = String(phase.clientId);
      if (!phasesByClient.has(key)) phasesByClient.set(key, []);
      phasesByClient.get(key).push(phase);
    }
  }

  for (const user of pointerUsers) {
    const phase = covering(phasesByClient.get(String(user._id)) || [], todayIsoDate(timeZoneOf(user)));
    const set = {};
    const unset = {};
    if (phase && !phase.activatedAt) {
      stats.pendingActivation += 1;
      Object.assign(unset, { tableInUse: "", tableInUseAt: "", workoutInUse: "", workoutInUseAt: "" });
    } else {
      if (phase && user.tableInUse && String(user.tableInUse) === String(phase.tableId)) {
        stats.pointerWasPhase += 1;
        Object.assign(unset, { tableInUse: "", tableInUseAt: "" });
      } else if (user.tableInUse) {
        stats.choices += 1;
        set.tableInUseAt = now;
      }
      if (user.workoutInUse) {
        stats.workoutsKept += 1;
        set.workoutInUseAt = now;
      }
    }
    if (dryRun) continue;
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    if (Object.keys(update).length) await users.updateOne({ _id: user._id }, update);
  }

  if (dryRun) return stats;

  await routines.updateMany({}, { $unset: { status: "", supersededBy: "", activatedAt: "" } });
  await dietPhases.updateMany({}, { $unset: { status: "", supersededBy: "" } });
  for (const [collection, names] of Object.entries(OLD_INDEXES)) {
    const existing = await db.collection(collection).indexes().catch(() => []);
    for (const name of names) {
      if (!existing.some((index) => index.name === name)) continue;
      await db.collection(collection).dropIndex(name);
      stats.droppedIndexes.push(`${collection}.${name}`);
    }
  }
  return stats;
}

module.exports = { migratePhaseChains };
