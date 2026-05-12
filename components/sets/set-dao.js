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
      const doc = await setSchema.findById(set._id);
      if (!doc) return null;

      // Actualizar con los datos recibidos
      for (const key in set) {
        if (key === "_id") continue;
        doc[key] = set[key];
      }

      return await doc.save();
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
