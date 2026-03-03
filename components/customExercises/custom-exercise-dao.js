const customExerciseSchema = require("./custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const setSchema = require("../sets/set-schema");
const { default: mongoose } = require("mongoose");

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
      // Actualización
      if (setsToCreate && setsToCreate.length > 0) {
        setsToCreate.map((setCreateTemp) => {
          customExercise.sets.forEach((setTemp) => {
            if (
              !isNaN(Number(setCreateTemp._id)) &&
              setCreateTemp._id === setTemp._id
            ) {
              const newId = new mongoose.Types.ObjectId();
              setCreateTemp._id = newId;
              setTemp._id = newId;
              return setCreateTemp;
            }
          });
        });

        await setSchema.insertMany(setsToCreate);
      }

      if (setsToUpdate && setsToUpdate.length > 0) {
        const bulkOps = [];

        setsToUpdate.forEach((set) => {
          // Cuando vengan atributos vacíos hay que eliminarlos del objeto en BBDD
          const updateOperation = {};
          const unsetOperation = {};

          if (set.reps === null || set.reps === undefined)
            unsetOperation.reps = "";
          else updateOperation.reps = set.reps;

          if (set.weight === null || set.weight === undefined)
            unsetOperation.weight = "";
          else updateOperation.weight = set.weight;

          if (set.rir === null || set.rir === undefined)
            unsetOperation.rir = "";
          else updateOperation.rir = set.rir;

          if (
            set.expectedRir === null ||
            set.expectedRir === undefined ||
            set.expectedRir.length === 0
          )
            unsetOperation.expectedRir = "";
          else updateOperation.expectedRir = set.expectedRir;

          if (
            set.expectedReps === null ||
            set.expectedReps === undefined ||
            set.expectedReps.length === 0
          )
            unsetOperation.expectedReps = "";
          else updateOperation.expectedReps = set.expectedReps;

          if (set.drop === null || set.drop === undefined)
            unsetOperation.drop = "";
          else updateOperation.drop = set.drop;

          if (set.restPause === null || set.restPause === undefined)
            unsetOperation.restPause = "";
          else updateOperation.restPause = set.restPause;

          if (set.doned === null || set.doned === undefined)
            unsetOperation.doned = "";
          else updateOperation.doned = set.doned;

          if (set.timeMin === null || set.timeMin === undefined)
            unsetOperation.timeMin = "";
          else updateOperation.timeMin = set.timeMin;

          if (set.timeSec === null || set.timeSec === undefined)
            unsetOperation.timeSec = "";
          else updateOperation.timeSec = set.timeSec;

          if (set.velocity === null || set.velocity === undefined)
            unsetOperation.velocity = "";
          else updateOperation.velocity = set.velocity;

          if (set.expectedMin === null || set.expectedMin === undefined)
            unsetOperation.expectedMin = "";
          else updateOperation.expectedMin = set.expectedMin;

          if (set.expectedSec === null || set.expectedSec === undefined)
            unsetOperation.expectedSec = "";
          else updateOperation.expectedSec = set.expectedSec;

          // Asegúrate de que _id sea un ObjectId válido
          const objectId = mongoose.Types.ObjectId(set._id);

          bulkOps.push({
            updateOne: {
              filter: { _id: objectId },
              update: {
                $set: updateOperation,
                $unset: unsetOperation,
              },
            },
          });
        });

        if (bulkOps.length > 0) {
          const result = await setSchema.bulkWrite(bulkOps);

          // result contiene información sobre las operaciones realizadas
          console.log("Operaciones realizadas:", result.nModified);
        }
      }

      if (setsToDelete && setsToDelete.length > 0) {
        await setSchema.deleteMany({ _id: { $in: setsToDelete } });

        customExercise.sets = customExercise.sets.filter(
          (setTemp) =>
            !setsToDelete.find(
              (setDeleteTemp) => setDeleteTemp._id === setTemp._id,
            ),
        );
      }

      const setsUpdated = customExercise.sets.map((setTemp) => setTemp._id);
      const queryUpdate = { $set: { sets: setsUpdated } };

      if (!customExercise.notes || customExercise.notes?.trim() === "")
        queryUpdate.$unset = { notes: 1 };
      else queryUpdate.$set.notes = customExercise.notes;

      customExercise = await customExerciseSchema.findByIdAndUpdate(
        customExercise._id,
        queryUpdate,
        { new: true },
      );

      return customExercise;
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
