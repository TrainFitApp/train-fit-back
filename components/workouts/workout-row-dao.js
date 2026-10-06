const tableSchema = require("../tables/table-schema");
const { toId, isObjectId } = require("./workout-tree");

// Ids de los entrenamientos de la MISMA fila que `workoutId` (misma posición
// en cada microciclo de su tabla), en el orden de los microciclos y SIN el
// propio workoutId. Vacío si el workout no cuelga de una tabla (plantilla
// suelta de entrenamiento). Una sola lectura: los microciclos van embebidos
// en la tabla (2026-10), y .lean() evita poblar las sesiones.
async function findRowSiblingWorkoutIds(workoutId) {
  if (!isObjectId(workoutId)) return [];
  const id = toId(workoutId);
  const table = await tableSchema
    .findOne({ "splits.workouts": workoutId })
    .select("splits._id splits.workouts")
    .lean();
  if (!table) return [];

  let index = -1;
  for (const split of table.splits || []) {
    index = (split.workouts || []).findIndex((w) => toId(w) === id);
    if (index >= 0) break;
  }
  if (index < 0) return [];

  return (table.splits || [])
    .map((split) => split.workouts?.[index])
    .filter((w) => w && toId(w) !== id);
}

module.exports = { findRowSiblingWorkoutIds };
