const setSchema = require("./set-schema");
const mealSchema = require("../meals/meal-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const { normalizeSetsOrder } = require("./set-order-util");

function getSetId(set) {
  const id = set?._id ?? set;
  return id == null ? null : id.toString();
}

async function normalizeCustomExerciseAfterSetDelete(customExercise, deletedSetId) {
  if (!customExercise) return;

  const normalizedSets = normalizeSetsOrder(
    (customExercise.sets || []).filter(
      (setTemp) => getSetId(setTemp) !== deletedSetId.toString(),
    ),
  );

  const bulkOps = normalizedSets.map((setTemp) => ({
    updateOne: {
      filter: { _id: setTemp._id },
      update: { $set: { order: setTemp.order } },
    },
  }));

  if (bulkOps.length > 0) {
    await setSchema.bulkWrite(bulkOps);
  }

  await customExerciseSchema.findByIdAndUpdate(customExercise._id, {
    $set: { sets: normalizedSets.map((setTemp) => setTemp._id) },
  });
}

module.exports = {
  async createSet(set) {
    return new Promise((resolve, reject) => {
      setSchema.create(set, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      });
    });
  },

  async createSets(sets) {
    return new Promise((resolve, reject) => {
      setSchema.insertMany(sets, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      });
    });
  },

  async updateSet(set) {
    try {
      const updateOperation = {};
      const unsetOperation = {};

      for (const key in set) {
        // _id no se actualiza. donedAt nunca se confía del cliente (deriva
        // de reloj entre dispositivo/servidor) — el backend lo calcula abajo.
        if (key === "_id" || key === "donedAt") continue;
        const value = set[key];
        const isEmptyArray = Array.isArray(value) && value.length === 0;
        if (value === null || value === undefined || isEmptyArray) {
          unsetOperation[key] = "";
        } else {
          updateOperation[key] = value;
        }
      }

      // donedAt: solo se fija en la transición real false->true (comprobando
      // el valor actual en BD, no basta con mirar el payload — el frontend
      // manda `doned` en cada guardado, no solo cuando cambia). Al desmarcar
      // una serie se limpia, para no dejar un timestamp obsoleto.
      if (updateOperation.doned === true) {
        const current = await setSchema.findById(set._id).select("doned");
        if (!current?.doned) {
          updateOperation.donedAt = new Date();
        }
      } else if (updateOperation.doned === false) {
        unsetOperation.donedAt = "";
      }

      const update = {};
      if (Object.keys(updateOperation).length > 0) update.$set = updateOperation;
      if (Object.keys(unsetOperation).length > 0) update.$unset = unsetOperation;

      if (Object.keys(update).length === 0) {
        return await setSchema.findById(set._id);
      }

      // runValidators: los min/max del schema valen también al editar (un
      // ValidationError acaba en 400 en errorHandler).
      return await setSchema.findByIdAndUpdate(set._id, update, { new: true, runValidators: true });
    } catch (err) {
      throw err;
    }
  },

  async deleteSet(id) {
    try {
      const customExercise = await customExerciseSchema.findOne({ sets: id });
      const result = await setSchema.deleteOne({ _id: id });

      await normalizeCustomExerciseAfterSetDelete(customExercise, id);
      return result;
    } catch (err) {
      throw err;
    }
  },
};
