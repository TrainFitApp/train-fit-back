const ownTableSchema = require("./own-table-schema");
const tableSchema = require("../tables/table-schema");
const userSchema = require("../users/schema");
const splitSchema = require("../splits/split-schema");
const workoutSchema = require("../workouts/workout-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const setSchema = require("../sets/set-schema");
const { default: mongoose } = require("mongoose");

function normalizeSetForTemplateCopy(setTemp) {
  delete setTemp.doned;
  delete setTemp.fail;
  delete setTemp.rir;
  delete setTemp.reps;
  delete setTemp.timeMin;
  delete setTemp.timeSec;

  setTemp.expectedRir = Array.isArray(setTemp.expectedRir)
    ? [...setTemp.expectedRir]
    : setTemp.expectedRir != null
      ? [setTemp.expectedRir]
      : [];

  setTemp.expectedReps = Array.isArray(setTemp.expectedReps)
    ? [...setTemp.expectedReps]
    : setTemp.expectedReps != null
      ? [setTemp.expectedReps]
      : [];
}

module.exports = {
  // async getTables(page, limit) {
  //   return new Promise((resolve, reject) =>
  //     tableSchema
  //       .find({})
  //       .skip(page * limit)
  //       .limit(limit)
  //       .exec((err, docs) => {
  //         if (err) return reject(err);
  //         return resolve(docs);
  //       })
  //   );
  // },

  async copyTable(idUser, idTable) {
    try {
      const tableD = await tableSchema.findById(idTable);
      const tableDoc = tableD.toObject();

      const splits = [];
      const workouts = [];
      const customExercises = [];
      const sets = [];
      tableDoc.splits.forEach((splitTemp) => {
        splitTemp._id = new mongoose.Types.ObjectId();
        splits.push(splitTemp);
        splitTemp.workouts.forEach((workoutTemp) => {
          workoutTemp._id = new mongoose.Types.ObjectId();
          workouts.push(workoutTemp);
          workoutTemp.exercises.forEach((customExerciseTemp) => {
            customExerciseTemp._id = new mongoose.Types.ObjectId();
            customExercises.push(customExerciseTemp);
            customExerciseTemp.sets.forEach((setTemp) => {
              setTemp._id = new mongoose.Types.ObjectId();
              normalizeSetForTemplateCopy(setTemp);
              sets.push(setTemp);
            });
          });
        });
      });
      await setSchema.insertMany(sets);
      await customExerciseSchema.insertMany(customExercises);
      await workoutSchema.insertMany(workouts);
      await splitSchema.insertMany(splits);

      delete tableDoc._id;
      return await ownTableSchema.create(tableDoc);
    } catch (e) {
      throw e;
    }
  },

  async copyOwnTable(idUser, idTable) {
    try {
      const tableD = await ownTableSchema.findById(idTable);
      const tableDoc = tableD.toObject();

      const splits = [];
      const workouts = [];
      const customExercises = [];
      const sets = [];
      tableDoc.name = tableDoc.name + " copia";
      tableDoc.splits.forEach((splitTemp) => {
        splitTemp._id = new mongoose.Types.ObjectId();
        splits.push(splitTemp);
        splitTemp.workouts.forEach((workoutTemp) => {
          workoutTemp._id = new mongoose.Types.ObjectId();
          workouts.push(workoutTemp);
          workoutTemp.exercises.forEach((customExerciseTemp) => {
            customExerciseTemp._id = new mongoose.Types.ObjectId();
            customExercises.push(customExerciseTemp);
            customExerciseTemp.sets.forEach((setTemp) => {
              setTemp._id = new mongoose.Types.ObjectId();
              normalizeSetForTemplateCopy(setTemp);
              sets.push(setTemp);
            });
          });
        });
      });
      await setSchema.insertMany(sets);
      await customExerciseSchema.insertMany(customExercises);
      await workoutSchema.insertMany(workouts);
      await splitSchema.insertMany(splits);

      delete tableDoc._id;
      const ownTableDoc = await ownTableSchema.create(tableDoc);

      const addOwnTableToUser = { $push: { ownTables: ownTableDoc._id } };
      await userSchema.findByIdAndUpdate(idUser, addOwnTableToUser);
      return ownTableDoc;
    } catch (e) {
      throw e;
    }
  },

  // async getSearchTables(page, limit, search, isOwn) {
  //   try {
  //     const searchTerms = search.split(" ");

  //     if (isOwn) {
  //       const aggregate = [
  //         { $match: { _id: mongoose.Types.ObjectId(userId) } },
  //         {
  //           $lookup: {
  //             from: "owntables",
  //             localField: "ownTables",
  //             foreignField: "_id",
  //             as: "tables",
  //           },
  //         },
  //         { $unwind: "$tables" },
  //         {
  //           $match: {
  //             $and: searchTerms.map((term) => ({
  //               "tables.name": { $regex: term, $options: "i" },
  //             })),
  //           },
  //         },
  //         { $group: { _id: "$_id", products: { $push: "$tables" } } },
  //         {
  //           $project: {
  //             _id: 0,
  //           },
  //         },
  //         { $skip: page * limit },
  //         { $limit: limit },
  //       ];
  //       return await aggregateService.aggregateFilter(
  //         await tableSchema.aggregate(aggregate),
  //         "tables"
  //       );
  //     } else {
  //       return await tableSchema
  //         .find({ name: { $regex: search, $options: "i" } })
  //         .skip(page * limit)
  //         .limit(limit)
  //         .exec();
  //     }
  //   } catch (e) {
  //     throw err;
  //   }
  // },

  // async createTable(table) {
  //   return new Promise((resolve, reject) =>
  //     tableSchema.create(table, (err, doc) => {
  //       if (err) return reject(err);
  //       return resolve(doc);
  //     })
  //   );
  // },

  async createTableToUser(idUser, standardTable) {
    try {
      const tableDoc = await ownTableSchema.create(standardTable);
      const addTableToUser = {
        $set: { tableInUse: tableDoc._id },
        $push: { ownTables: tableDoc._id },
      };
      await userSchema.findByIdAndUpdate(idUser, addTableToUser);
      return tableDoc;
    } catch (err) {
      throw err;
    }
  },

  // async updateTable(table) {
  //   const update = { $set: table };

  //   return new Promise((resolve, reject) =>
  //     tableSchema.findByIdAndUpdate(
  //       table._id,
  //       update,
  //       { new: true },
  //       (err, docTable) => {
  //         if (err) return reject(err);
  //         return resolve(docTable);
  //       }
  //     )
  //   );
  // },

  async deleteTable(idUser, idTable) {
    try {
      const pullTableFromUser = { $pull: { ownTables: idTable } };
      await userSchema.findByIdAndUpdate(idUser, pullTableFromUser);
      return await ownTableSchema.deleteOne({ _id: idTable });
    } catch (e) {
      throw e;
    }
  },

  // async deleteTableSplit(idTable, idSplit) {
  //   const deleteSplit = {
  //     $pull: { splits: idSplit },
  //   };

  //   return new Promise((resolve, reject) =>
  //     tableSchema.findByIdAndUpdate(idTable, deleteSplit, {}, (err, docs) => {
  //       if (err) return reject(err);
  //       return resolve(docs);
  //     })
  //   );
  // },
};
