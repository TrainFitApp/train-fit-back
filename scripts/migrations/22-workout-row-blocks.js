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
//         (invariante y reglas de unificación en
//         components/workouts/workout-row-blocks.js#unifyRowBlocks).
//
// Idempotente: una fila que ya cumple el invariante no se escribe.

const { unifyRowBlocks } = require("../../components/workouts/workout-row-blocks");

const idOf = (value) => (value && value._id ? value._id : value)?.toString() || "";

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

module.exports = { migrateWorkoutRowBlocks };
