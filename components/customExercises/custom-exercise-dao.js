const customExerciseSchema = require("./custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const setSchema = require("../sets/set-schema");
const { default: mongoose } = require("mongoose");

const SET_UPDATE_FIELDS = [
  "reps",
  "weight",
  "rir",
  "expectedRir",
  "expectedReps",
  "drop",
  "restPause",
  "doned",
  "timeMin",
  "timeSec",
  "velocity",
  "expectedMin",
  "expectedSec",
  "order",
];

function plainSet(set) {
  if (!set) return {};
  const value = typeof set.toObject === "function" ? set.toObject() : { ...set };
  delete value.__v;
  delete value.displayOrder;
  return value;
}

function getSetId(set) {
  const id = set?._id ?? set;
  return id == null ? null : id.toString();
}

function isTemporarySetId(id) {
  return id != null && !Number.isNaN(Number(id));
}

function buildSetUpdate(set) {
  const updateOperation = {};
  const unsetOperation = {};

  SET_UPDATE_FIELDS.forEach((field) => {
    const value = set[field];
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    if (value === null || value === undefined || isEmptyArray) {
      unsetOperation[field] = "";
    } else {
      updateOperation[field] = value;
    }
  });

  const update = {};
  if (Object.keys(updateOperation).length > 0) update.$set = updateOperation;
  if (Object.keys(unsetOperation).length > 0) update.$unset = unsetOperation;
  return update;
}

module.exports = {
  async findCustomExerciseById(id) {
    return new Promise((resolve, reject) =>
      customExerciseSchema.findById(id).exec((err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  // Para cuando cree Creación de customExercise
  // if (!customExercise._id) {
  //   customExercise.sets = await setSchema.insertMany(setsToCreate);
  //   customExercise = await customExerciseSchema.create(customExercise);

  //   return customExercise;
  // }
  async updateCustomExercise(
    customExercise,
    setsToCreate,
    setsToUpdate,
    setsToDelete,
  ) {
    try {
      const setsToDeleteIds = new Set((setsToDelete || []).map(getSetId));
      const createByTempId = new Map();
      const newIds = new Set();

      (setsToCreate || []).forEach((setCreateTemp) => {
        const createSet = plainSet(setCreateTemp);
        const tempId = getSetId(createSet);
        const newId = new mongoose.Types.ObjectId();

        createSet._id = newId;
        createByTempId.set(tempId, createSet);
        newIds.add(newId.toString());
      });

      const finalSets = (customExercise.sets || [])
        .map((setTemp) => {
          const currentSet = plainSet(setTemp);
          const currentId = getSetId(currentSet);

          if (setsToDeleteIds.has(currentId)) {
            return null;
          }

          if (isTemporarySetId(currentId) && createByTempId.has(currentId)) {
            return {
              ...createByTempId.get(currentId),
              ...currentSet,
              _id: createByTempId.get(currentId)._id,
            };
          }

          if (!currentId || isTemporarySetId(currentId)) {
            const newId = new mongoose.Types.ObjectId();
            newIds.add(newId.toString());
            return {
              ...currentSet,
              _id: newId,
            };
          }

          return currentSet;
        })
        .filter(Boolean)
        .map((setTemp, index) => ({
          ...setTemp,
          order: index,
        }));

      const bulkOps = [];

      finalSets.forEach((setTemp) => {
        const setId = getSetId(setTemp);
        const cleanSet = plainSet(setTemp);

        if (newIds.has(setId)) {
          bulkOps.push({
            insertOne: {
              document: cleanSet,
            },
          });
          return;
        }

        const update = buildSetUpdate(cleanSet);
        if (Object.keys(update).length === 0) {
          return;
        }

        bulkOps.push({
          updateOne: {
            filter: { _id: mongoose.Types.ObjectId(setId) },
            update,
          },
        });
      });

      if (bulkOps.length > 0) {
        await setSchema.bulkWrite(bulkOps);
      }

      const persistedSetIdsToDelete = Array.from(setsToDeleteIds).filter((id) =>
        mongoose.Types.ObjectId.isValid(id),
      );

      if (persistedSetIdsToDelete.length > 0) {
        await setSchema.deleteMany({
          _id: { $in: persistedSetIdsToDelete },
        });
      }

      const setsUpdated = finalSets.map((setTemp) => setTemp._id);
      const queryUpdate = { $set: { sets: setsUpdated } };

      if (!customExercise.notes || customExercise.notes?.trim() === "")
        queryUpdate.$unset = { notes: 1 };
      else queryUpdate.$set.notes = customExercise.notes;

      await customExerciseSchema.findByIdAndUpdate(
        customExercise._id,
        queryUpdate,
        { new: true },
      );

      return await customExerciseSchema.findById(customExercise._id);
    } catch (err) {
      throw err;
    }
  },

  async addSetToCustomExercise(id, set) {
    try {
      const newSet = await setSchema.create(set);
      const update = { $push: { sets: newSet } };
      const customExerciseDoc = await customExerciseSchema.findByIdAndUpdate(
        id,
        update,
        { new: true },
      );
      return customExerciseDoc;
    } catch (err) {
      throw err;
    }
  },

  async copySetOnCustomExercise(order, customExercise) {
    try {
      const newSetId = new mongoose.Types.ObjectId();
      let newSet = customExercise.sets.find((sTemp) => !sTemp._id);

      customExercise.sets.forEach((sTemp) => {
        if (!sTemp._id) sTemp._id = newSetId;
      });

      const update = {
        $push: {
          sets: newSetId,
        },
      };

      const bulkOps = [];

      bulkOps.push({
        insertOne: {
          document: newSet,
        },
      });

      customExercise.sets.forEach((sTemp) => {
        bulkOps.push({
          updateOne: {
            filter: { _id: sTemp._id },
            update: {
              $set: sTemp,
            },
          },
        });
      });

      const bulkOpsCE = [];

      bulkOpsCE.push({
        updateOne: {
          filter: { _id: customExercise._id },
          update: {
            $set: { sets: customExercise.sets.map((sTemp) => sTemp._id) },
          },
        },
      });

      await setSchema.bulkWrite(bulkOps);
      await customExerciseSchema.bulkWrite(bulkOpsCE);

      const customExerciseDoc = await customExerciseSchema.findById(
        customExercise._id,
      );
      return customExerciseDoc;
    } catch (err) {
      throw err;
    }
  },

  async deleteCustomExercise(id) {
    try {
      const customExercise = await customExerciseSchema.findById(id);

      // Obtén los IDs de los conjuntos asociados
      const setIds = customExercise.sets.map((set) => set._id);

      // Elimina los conjuntos asociados
      await setSchema.deleteMany({ _id: { $in: setIds } });

      // Elimina los CustomExercises
      const result = await customExerciseSchema.deleteOne({ _id: id });
      return result;
    } catch (err) {
      throw err;
    }
  },

  async deleteCustomExercises(ids) {
    try {
      // Busca los CustomExercises que se van a eliminar
      const customExercises = await customExerciseSchema.find({
        _id: { $in: ids },
      });

      // Obtén los IDs de los conjuntos asociados
      const setIds = customExercises.flatMap((exercise) =>
        exercise.sets.map((set) => set._id),
      );

      // Elimina los conjuntos asociados
      await setSchema.deleteMany({ _id: { $in: setIds } });

      // Elimina los CustomExercises
      const result = await customExerciseSchema.deleteMany({
        _id: { $in: ids },
      });
      return result;
    } catch (err) {
      throw err;
    }
  },
};
