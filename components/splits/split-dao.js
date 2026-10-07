const { default: mongoose } = require("mongoose");
const { badRequest, conflict, notFound } = require("../util/http-error");
const tableSchema = require("../tables/table-schema");
const workoutSchema = require("../workouts/workout-schema");
const userSchema = require("../users/user-schema");
const { isSamePermutation } = require("../util/permutation-util");
const { toId, plain, newId, cloneWorkout, isObjectId } = require("../workouts/workout-tree");

// Microciclos embebidos en su rutina (Table.splits[], 2026-10). Cada
// microciclo solo guarda sus datos y los ids de sus sesiones en orden; las
// sesiones son documentos Workout aparte.

function standardSplit(name) {
  return { _id: newId(), name: name || "Split Predeterminado", workouts: [] };
}

const tableNotFound = () => notFound("Table not found", "TABLE_NOT_FOUND");

// Todos los microciclos tienen el mismo número de entrenamientos (filas,
// ver workouts/workout-row-blocks.js): uno en blanco solo cabe en una rutina
// sin entrenamientos. Con entrenamientos, el microciclo nuevo se duplica de
// otro (addSplitToTable, con o sin series).
const blankSplitWithWorkouts = () =>
  conflict(
    "La rutina ya tiene entrenamientos: el microciclo nuevo se crea duplicando otro",
    "SPLIT_BLANK_WITH_WORKOUTS",
  );
const NO_WORKOUTS = { "splits.workouts.0": { $exists: false } };

async function populatedSplits(idTable) {
  const table = await tableSchema.findById(idTable);
  return table ? table.splits : [];
}

module.exports = {
  async getSplit(id) {
    if (!isObjectId(id)) return null;
    const table = await tableSchema.findOne({ "splits._id": id });
    return table?.splits?.id(id) || null;
  },

  // Duplica el microciclo `idSplit` justo detrás de él (o crea uno vacío si
  // no es de la tabla y la rutina aún no tiene entrenamientos). Las sesiones
  // se copian sin su ejecución, y sus series solo con `withSets` (sin ellas,
  // los ejercicios quedan sin series).
  async addSplitToTable(idTable, idSplit, withSets) {
    const table = await tableSchema.findById(idTable);
    if (!table) throw tableNotFound();

    const splitIndex = Math.max(0, table.splits.findIndex((split) => toId(split) === toId(idSplit)));
    const source = table.splits.find((split) => toId(split) === toId(idSplit));
    if (!source && table.splits.some((split) => (split.workouts || []).length)) throw blankSplitWithWorkouts();

    const newWorkouts = source
      ? (source.workouts || []).filter(Boolean).map((workout) => cloneWorkout(workout, { withSets: Boolean(withSets) }))
      : [];
    const newSplit = source
      ? { ...plain(source), _id: newId(), workouts: newWorkouts.map((workout) => workout._id) }
      : standardSplit();

    if (newWorkouts.length) await workoutSchema.insertMany(newWorkouts);
    await tableSchema.updateOne(
      { _id: idTable },
      { $push: { splits: { $each: [newSplit], $position: splitIndex + 1 } } },
    );

    return (await populatedSplits(idTable)).find((split) => toId(split) === toId(newSplit._id)) || null;
  },

  async updateSplit(id, patch) {
    const $set = {};
    for (const [key, value] of Object.entries(patch || {})) $set[`splits.$.${key}`] = value;
    if (!Object.keys($set).length) return { matchedCount: 0 };
    return tableSchema.updateOne({ "splits._id": id }, { $set }, { runValidators: true });
  },

  // Planificador visual (Fase C) — reordena las columnas (splits) de una
  // tabla. Nunca crea/borra splits, solo reescribe el orden pedido.
  async reorderSplits(idTable, splitIdsOrder) {
    const table = await tableSchema.findById(idTable).select("splits._id").lean();
    if (!table) throw tableNotFound();

    const currentIds = (table.splits || []).map(toId);
    const requestedIds = (Array.isArray(splitIdsOrder) ? splitIdsOrder : []).map(toId);

    // Solo reordena: una permutación exacta de los microciclos actuales.
    if (!isSamePermutation(currentIds, requestedIds)) {
      throw badRequest("splitIdsOrder debe ser una permutación exacta de los splits actuales", "INVALID_SPLIT_ORDER");
    }

    const full = await tableSchema.findById(idTable).select("splits").lean();
    const byId = new Map(full.splits.map((split) => [toId(split), split]));
    await tableSchema.updateOne({ _id: idTable }, { $set: { splits: requestedIds.map((id) => byId.get(id)) } });
    return populatedSplits(idTable);
  },

  // "Añadir semana" en blanco (a diferencia de addSplitToTable, que
  // duplica un microciclo existente): solo en una rutina sin entrenamientos,
  // comprobado en la misma escritura.
  async createBlankSplitAndAddToTable(idTable, name) {
    const result = await tableSchema.updateOne({ _id: idTable, ...NO_WORKOUTS }, { $push: { splits: standardSplit(name) } });
    if (!result.matchedCount) {
      throw (await tableSchema.exists({ _id: idTable })) ? blankSplitWithWorkouts() : tableNotFound();
    }
    return populatedSplits(idTable);
  },

  async deleteSplit(idTable, idSplit) {
    return this.deleteSplits(idTable, [idSplit]);
  },

  // Quita los microciclos de la tabla y borra sus sesiones. Si la sesión en
  // curso del usuario era una de ellas, se le vacía el puntero.
  async deleteSplits(idTable, splitIds, userId, workoutInUse) {
    const ids = (splitIds || []).map(toId).filter(isObjectId);
    const table = await tableSchema.findById(idTable).select("splits._id splits.workouts").lean();
    const selected = (table?.splits || []).filter((split) => ids.includes(toId(split)));
    const workoutIds = selected.flatMap((split) => (split.workouts || []).map(toId));

    const clearedWorkoutInUse = Boolean(workoutInUse && workoutIds.includes(toId(workoutInUse)));

    await tableSchema.updateOne(
      { _id: idTable },
      { $pull: { splits: { _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } } } },
    );
    if (workoutIds.length) await workoutSchema.deleteMany({ _id: { $in: workoutIds } });

    if (clearedWorkoutInUse && userId) {
      await userSchema.findByIdAndUpdate(userId, { $unset: { workoutInUse: 1, workoutInUseAt: 1 } });
    }

    return {
      deletedSplitIds: ids,
      clearedWorkoutInUse,
    };
  },
};
