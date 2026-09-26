const tableSchema = require("../tables/table-schema");
const splitSchema = require("../splits/split-schema");

// Ids de los entrenamientos de la MISMA fila que `workoutId` (misma posición
// en cada microciclo de su tabla), en el orden de los microciclos y SIN el
// propio workoutId. Vacío si el workout no cuelga de una tabla (plantilla
// suelta de entrenamiento). .lean() a propósito: solo hacen falta los ids,
// sin el autopopulate de splits → workouts → ejercicios → series.
async function findRowSiblingWorkoutIds(workoutId) {
  const id = workoutId.toString();
  const split = await splitSchema.findOne({ workouts: workoutId }).select("workouts").lean();
  if (!split) return [];
  const index = (split.workouts || []).findIndex((w) => w.toString() === id);
  if (index < 0) return [];

  const table = await tableSchema.findOne({ splits: split._id }).select("splits").lean();
  if (!table) return [];
  const splits = await splitSchema
    .find({ _id: { $in: table.splits } })
    .select("workouts")
    .lean();

  return splits
    .map((s) => s.workouts?.[index])
    .filter((w) => w && w.toString() !== id);
}

module.exports = { findRowSiblingWorkoutIds };
