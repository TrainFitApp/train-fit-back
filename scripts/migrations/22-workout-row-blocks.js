// Bloques por FILA (2026-10).
//
// Antes:  cada microciclo podía tener sus propios bloques. Los creados antes
//         de que los bloques fueran de la fila, y los que traía una plantilla
//         (se aplicaba microciclo a microciclo), tenían un _id distinto en
//         cada uno o solo existían en alguno: borrar o editar un bloque no
//         llegaba a los demás microciclos. Algunos ejercicios apuntaban
//         además a un bloque que ya no existía (pegar, crear en todos los
//         microciclos).
// Ahora:  todos los entrenamientos de una fila tienen los mismos bloques, con
//         el mismo _id, y ningún ejercicio apunta a un bloque inexistente
//         (invariante en components/workouts/workout-row-blocks.js; reglas
//         de unificación en unifyRowBlocks, aquí abajo).
//
// Idempotente: una fila que ya cumple el invariante no se escribe.

const { pickRowExercise } = require("../../components/workouts/workout-row-blocks");

const idOf = (value) => (value && value._id ? value._id : value)?.toString() || "";

const normalizedName = (name) => String(name || "").trim().toLowerCase();

const BLOCK_FIELDS = ["name", "type", "order", "rounds", "restBetweenExercises", "restBetweenRounds", "instructions"];
const blocksSignature = (blocks) =>
  JSON.stringify(
    [...(blocks || [])]
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((block) => [idOf(block), ...BLOCK_FIELDS.map((field) => block[field] ?? null)]),
  );
const blockIdsSignature = (exercises) =>
  JSON.stringify((exercises || []).map((exercise) => (exercise.blockId ? idOf(exercise.blockId) : null)));

/**
 * Deja una fila cumpliendo el invariante. `row`: sus entrenamientos en orden
 * de microciclo, cada uno { _id, blocks, exercises }. Devuelve, en el mismo
 * orden, { _id, blocks, exercises, changed }.
 *
 * - Un bloque se reconoce en otro microciclo por su _id o, si no lo comparte
 *   (datos antiguos: cada microciclo creaba el suyo), por tipo + nombre (y
 *   el número de aparición si el mismo tipo y nombre se repite).
 * - Cada bloque se queda con el _id y los datos de su primera aparición en
 *   la fila; el orden, el de la fila (0..n-1).
 * - Un bloque que falta en un microciclo se crea allí, y se le asignan los
 *   ejercicios equivalentes de la fila (pickRowExercise) que no estén ya en
 *   otro bloque.
 * - Ningún ejercicio queda apuntando a un bloque que no existe.
 */
function unifyRowBlocks(row) {
  const canonical = [];
  const byId = new Map();
  const byKey = new Map();
  const localToCanonical = row.map(() => new Map());

  row.forEach((workout, workoutIndex) => {
    const local = localToCanonical[workoutIndex];
    const used = new Set();
    const occurrences = new Map();
    const blocks = [...(workout.blocks || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const block of blocks) {
      const base = `${block.type || "straight"}|${normalizedName(block.name)}`;
      const occurrence = (occurrences.get(base) || 0) + 1;
      occurrences.set(base, occurrence);
      const key = `${base}#${occurrence}`;

      let entry = byId.get(idOf(block)) || byKey.get(key) || null;
      if (entry && used.has(entry)) entry = null;
      if (!entry) {
        entry = { block, sourceIndex: workoutIndex, members: [] };
        canonical.push(entry);
        if (!byKey.has(key)) byKey.set(key, entry);
      }
      used.add(entry);
      byId.set(idOf(block), entry);
      local.set(idOf(block), entry);
    }
  });

  for (const entry of canonical) {
    (row[entry.sourceIndex].exercises || []).forEach((exercise, index) => {
      if (exercise.blockId && idOf(exercise.blockId) === idOf(entry.block)) {
        entry.members.push({ index, exercise: exercise.exercise });
      }
    });
  }

  const rowBlocks = canonical.map((entry, order) => ({ ...entry.block, order }));

  return row.map((workout, workoutIndex) => {
    const local = localToCanonical[workoutIndex];
    let exercises = (workout.exercises || []).map((exercise) => {
      const entry = exercise.blockId ? local.get(idOf(exercise.blockId)) : null;
      const current = exercise.blockId ? idOf(exercise.blockId) : "";
      const next = entry ? idOf(entry.block) : "";
      return current === next ? exercise : { ...exercise, blockId: entry ? entry.block._id : null };
    });

    const present = new Set(local.values());
    for (const entry of canonical) {
      if (present.has(entry)) continue;
      for (const member of entry.members) {
        const target = pickRowExercise(member.index, member.exercise, exercises);
        if (!target || target.blockId) continue;
        exercises = exercises.map((exercise) => (exercise === target ? { ...exercise, blockId: entry.block._id } : exercise));
      }
    }

    const changed =
      blocksSignature(workout.blocks) !== blocksSignature(rowBlocks) ||
      blockIdsSignature(workout.exercises) !== blockIdsSignature(exercises);
    return { _id: workout._id, blocks: rowBlocks.map((block) => ({ ...block })), exercises, changed };
  });
}

async function migrateWorkoutRowBlocks(db, { dryRun = false } = {}) {
  const tables = db.collection("tables");
  const workouts = db.collection("workouts");
  const stats = { tables: 0, rows: 0, workouts: 0, orphanBlockIds: 0, unifiedBlocks: 0 };

  const cursor = tables.find({}, { projection: { "splits.workouts": 1 } });
  for await (const table of cursor) {
    const splits = table.splits || [];
    const ids = splits.flatMap((split) => split.workouts || []);
    if (!ids.length) continue;

    const docs = await workouts.find({ _id: { $in: ids } }, { projection: { blocks: 1, exercises: 1 } }).toArray();
    const byId = new Map(docs.map((doc) => [idOf(doc), doc]));
    const rowCount = Math.max(0, ...splits.map((split) => (split.workouts || []).length));

    const operations = [];
    for (let index = 0; index < rowCount; index += 1) {
      const row = splits.map((split) => byId.get(idOf(split.workouts?.[index]))).filter(Boolean);
      const hasBlocks = row.some(
        (workout) => (workout.blocks || []).length || (workout.exercises || []).some((exercise) => exercise.blockId),
      );
      if (!hasBlocks) continue;

      const unified = unifyRowBlocks(row);
      let rowChanged = false;
      unified.forEach((result, position) => {
        if (!result.changed) return;
        rowChanged = true;
        const before = row[position];
        const validIds = new Set((before.blocks || []).map(idOf));
        stats.orphanBlockIds += (before.exercises || []).filter(
          (exercise) => exercise.blockId && !validIds.has(idOf(exercise.blockId)),
        ).length;
        stats.workouts += 1;
        operations.push({
          updateOne: {
            filter: { _id: result._id },
            update: { $set: { blocks: result.blocks, exercises: result.exercises }, $inc: { __v: 1 } },
          },
        });
      });
      if (rowChanged) {
        stats.rows += 1;
        stats.unifiedBlocks += unified[0]?.blocks.length || 0;
      }
    }

    if (!operations.length) continue;
    stats.tables += 1;
    if (!dryRun) await workouts.bulkWrite(operations, { ordered: false });
  }

  return stats;
}

module.exports = { migrateWorkoutRowBlocks, unifyRowBlocks };
