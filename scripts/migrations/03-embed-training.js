// Entrenamiento embebido (2026-10, docs/analisis-modelo-datos.md P2).
//
// Antes:  tables.splits[] -> splits.workouts[] -> workouts.exercises[]
//         -> customexercises.sets[] -> sets      (+ pinnedexercisenotes)
// Ahora:  tables.splits[]       microciclos EMBEBIDOS {_id, name, objective,
//                               purpose, workouts: [ids]}
//         tables.pinnedNotes[]  notas ancladas EMBEBIDAS
//         workouts.exercises[]  ejercicios EMBEBIDOS con sus series dentro
//
// Se conservan TODOS los _id (microciclos, ejercicios, series, notas): las
// apps siguen mandando los mismos ids a las mismas rutas.
//
// Idempotente: un documento ya embebido se salta. Las referencias colgantes
// (a un ejercicio, serie o microciclo que ya no existe) se descartan, que es
// lo que ya hacía el populate que veían las apps. Trabaja con las
// colecciones en crudo, sin modelos: ni hooks ni casteos de por medio.
// Las colecciones antiguas solo se borran con --drop-old.


const isRef = (value) => value != null && typeof value === "object" && String(value._bsontype).toLowerCase() === "objectid";
const isRefArray = (list) => Array.isArray(list) && list.some(isRef);
const key = (value) => String(value?._id ?? value);

function byId(docs) {
  return new Map(docs.map((doc) => [key(doc), doc]));
}

async function fetchByIds(collection, ids) {
  if (!ids.length) return new Map();
  return byId(await collection.find({ _id: { $in: ids } }).toArray());
}

function embedSet(set) {
  const { __v, ...rest } = set;
  return rest;
}

function embedExercise(customExercise, setsById, stats) {
  const { __v, sets = [], ...rest } = customExercise;
  const embedded = [];
  for (const ref of sets) {
    const set = setsById.get(key(ref));
    if (set) embedded.push(embedSet(set));
    else stats.danglingSets += 1;
  }
  stats.sets += embedded.length;
  return { ...rest, sets: embedded };
}

/**
 * Migra una base ya conectada (`db` = conexión nativa de mongodb). Devuelve
 * las cifras de lo hecho (o de lo que se haría con dryRun).
 */
async function migrateEmbedTraining(db, { dryRun = false, dropOld = false, log = () => {} } = {}) {
  const stats = {
    workouts: 0,
    exercises: 0,
    sets: 0,
    tables: 0,
    splits: 0,
    pinnedNotes: 0,
    danglingExercises: 0,
    danglingSets: 0,
    danglingSplits: 0,
    orphanExercises: 0,
    orphanSets: 0,
    orphanSplits: 0,
    orphanPinnedNotes: 0,
    kindTemplates: 0,
    kindSessions: 0,
    setsTimeConverted: 0,
    dropped: [],
  };

  const workouts = db.collection("workouts");
  const tables = db.collection("tables");
  const customExercises = db.collection("customexercises");
  const sets = db.collection("sets");
  const splits = db.collection("splits");
  const pinnedNotes = db.collection("pinnedexercisenotes");

  const usedExercises = new Set();
  const usedSets = new Set();
  const usedSplits = new Set();
  const usedNotes = new Set();

  // 1) Sesiones: ejercicios y series dentro.
  for await (const workout of workouts.find({ "exercises.0": { $type: "objectId" } })) {
    const exercisesById = await fetchByIds(customExercises, workout.exercises.filter(isRef));
    const setIds = [...exercisesById.values()].flatMap((exercise) => (exercise.sets || []).filter(isRef));
    const setsById = await fetchByIds(sets, setIds);

    const embedded = [];
    for (const ref of workout.exercises) {
      const exercise = exercisesById.get(key(ref));
      if (!exercise) {
        stats.danglingExercises += 1;
        continue;
      }
      usedExercises.add(key(exercise));
      (exercise.sets || []).forEach((setRef) => usedSets.add(key(setRef)));
      embedded.push(embedExercise(exercise, setsById, stats));
    }
    stats.workouts += 1;
    stats.exercises += embedded.length;
    if (!dryRun) {
      await workouts.updateOne({ _id: workout._id }, { $set: { exercises: embedded }, $inc: { __v: 1 } });
    }
  }

  // 2) Rutinas: microciclos y notas ancladas dentro.
  for await (const table of tables.find({
    $or: [{ "splits.0": { $type: "objectId" } }, { pinnedNotes: { $exists: false } }],
  })) {
    const update = {};

    if (isRefArray(table.splits)) {
      const splitsById = await fetchByIds(splits, table.splits.filter(isRef));
      const embedded = [];
      for (const ref of table.splits) {
        const split = splitsById.get(key(ref));
        if (!split) {
          stats.danglingSplits += 1;
          continue;
        }
        usedSplits.add(key(split));
        const { __v, ...rest } = split;
        embedded.push({ ...rest, workouts: rest.workouts || [] });
      }
      stats.splits += embedded.length;
      update.splits = embedded;
    }

    const notes = await pinnedNotes.find({ tableId: table._id }).toArray();
    notes.forEach((note) => usedNotes.add(key(note)));
    if (!Array.isArray(table.pinnedNotes)) {
      update.pinnedNotes = notes.map(({ __v, tableId, ...note }) => note);
      stats.pinnedNotes += notes.length;
    }

    if (Object.keys(update).length) {
      stats.tables += 1;
      if (!dryRun) await tables.updateOne({ _id: table._id }, { $set: update });
    }
  }

  // 3) Lo que no colgaba de nada no se migra: se cuenta para el informe.
  const count = async (collection, used) => {
    let orphans = 0;
    for await (const doc of collection.find({}, { projection: { _id: 1 } })) {
      if (!used.has(key(doc))) orphans += 1;
    }
    return orphans;
  };
  // Solo tiene sentido en la primera pasada (después ya no se marcan como
  // usados los que se migraron antes).
  if (stats.workouts || stats.tables) {
    stats.orphanExercises = await count(customExercises, usedExercises);
    stats.orphanSets = await count(sets, usedSets);
    stats.orphanSplits = await count(splits, usedSplits);
    stats.orphanPinnedNotes = await count(pinnedNotes, usedNotes);
  }

  // 3b) Sesión o plantilla (discriminador `kind`, workout-base-schema.js):
  //     una plantilla es la que tiene trainerId. Cada una se queda solo con
  //     sus campos; las plantillas sin ficha toman los valores por defecto.
  const TEMPLATE_FIELDS = { trainerId: "", description: "", level: "", tags: "", equipment: "" };
  const SESSION_FIELDS = {
    clientNotes: "", date: "", order: "", cronometer: "", paused: "", startedAt: "", rest: "",
    isPlannedRestDay: "", readinessPre: "", perceivedEffortPost: "", sorenessPre: "",
  };
  const templateFilter = { kind: { $exists: false }, trainerId: { $type: "objectId" } };
  stats.kindTemplates = await workouts.countDocuments(templateFilter);
  stats.kindSessions = await workouts.countDocuments({ kind: { $exists: false }, trainerId: { $not: { $type: "objectId" } } });
  if (!dryRun) {
    await workouts.updateMany(templateFilter, { $set: { kind: "template" }, $unset: SESSION_FIELDS });
    for (const [field, value] of Object.entries({ description: "", level: "intermedio", tags: [], equipment: [] })) {
      await workouts.updateMany({ kind: "template", [field]: { $exists: false } }, { $set: { [field]: value } });
    }
    await workouts.updateMany({ kind: { $exists: false } }, { $set: { kind: "session" }, $unset: TEMPLATE_FIELDS });
  }

  // 3c) Series: los minutos/segundos sueltos de las apps de 2025 pasan a
  //     "M:SS" (expectedTime/time) y desaparecen.
  const asTime = (min, sec) => {
    const total = Math.max(0, Math.round((Number(min) || 0) * 60 + (Number(sec) || 0)));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };
  const oldTimeFilter = {
    $or: ["expectedMin", "expectedSec", "timeMin", "timeSec"].map((f) => ({ [`exercises.sets.${f}`]: { $exists: true } })),
  };
  for await (const workout of workouts.find(oldTimeFilter)) {
    const exercises = (workout.exercises || []).map((exercise) => ({
      ...exercise,
      sets: (exercise.sets || []).map((set) => {
        const { expectedMin, expectedSec, timeMin, timeSec, ...rest } = set;
        if (expectedMin == null && expectedSec == null && timeMin == null && timeSec == null) return set;
        stats.setsTimeConverted += 1;
        if (!rest.expectedTime && (expectedMin != null || expectedSec != null)) rest.expectedTime = asTime(expectedMin, expectedSec);
        if (!rest.time && (timeMin != null || timeSec != null)) rest.time = asTime(timeMin, timeSec);
        return rest;
      }),
    }));
    if (!dryRun) await workouts.updateOne({ _id: workout._id }, { $set: { exercises }, $inc: { __v: 1 } });
  }

  // 4) Colecciones antiguas: solo con --drop-old y si ya no queda nada sin
  //    migrar.
  if (dropOld && !dryRun) {
    const pendingWorkouts = await workouts.countDocuments({ "exercises.0": { $type: "objectId" } });
    const pendingTables = await tables.countDocuments({ "splits.0": { $type: "objectId" } });
    if (pendingWorkouts || pendingTables) {
      throw new Error(`Quedan ${pendingWorkouts} sesiones y ${pendingTables} rutinas sin migrar: no se borra nada.`);
    }
    const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of ["customexercises", "sets", "splits", "pinnedexercisenotes"]) {
      if (existing.has(name)) {
        await db.dropCollection(name);
        stats.dropped.push(name);
        log(`dropped ${name}`);
      }
    }
  }

  return stats;
}

module.exports = { migrateEmbedTraining };
