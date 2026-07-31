const userSchema = require("../users/schema");
const tableSchema = require("./table-schema");
const { default: mongoose } = require("mongoose");
const splitSchema = require("../splits/split-schema");
const setSchema = require("../sets/set-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const serverDomain = process.env.SERVER_DOMAIN;

function normalizeSetForTemplateCopy(setTemp) {
  delete setTemp.doned;
}

async function copyHierarchy(tableDoc) {
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
}

module.exports = {
  async getTables(page, limit, own = false, idUser = null, defaultOnly = false) {
    if (own && idUser) {
      return tableSchema
        .find({ userId: mongoose.Types.ObjectId(idUser) })
        .skip(page * limit)
        .limit(limit)
        .exec();
    }
    if (defaultOnly && idUser) {
      return tableSchema
        .find({ userId: { $exists: false } })
        .skip(page * limit)
        .limit(limit)
        .exec();
    }
    // All routines: user's own + public templates
    return tableSchema
      .find({
        $or: [
          { userId: mongoose.Types.ObjectId(idUser) },
          { userId: { $exists: false } }
        ]
      })
      .skip(page * limit)
      .limit(limit)
      .exec();
  },

  async getTableById(id) {
    return tableSchema.findById(id).exec();
  },

  async copyTable(idUser, idTable) {
    try {
      const tableD = await tableSchema.findById(idTable);
      if (!tableD) throw new Error("Table not found");
      const tableDoc = tableD.toObject();

      await copyHierarchy(tableDoc);

      delete tableDoc._id;
      return await tableSchema.create({
        ...tableDoc,
        userId: idUser,
      });
    } catch (e) {
      throw e;
    }
  },

  async duplicateTable(idUser, idTable) {
    try {
      const tableD = await tableSchema.findById(idTable);
      if (!tableD) throw new Error("Table not found");
      const tableDoc = tableD.toObject();

      tableDoc.name = tableDoc.name + " copia";

      await copyHierarchy(tableDoc);

      delete tableDoc._id;
      return await tableSchema.create({
        ...tableDoc,
        userId: idUser,
      });
    } catch (e) {
      throw e;
    }
  },

  async copySharedTable(idUser, idTable) {
    try {
      const splits = [];
      const workouts = [];
      const customExercises = [];
      const sets = [];

      let sharedTable = await tableSchema.findById(idTable);
      sharedTable = sharedTable.toObject();

      sharedTable.splits.forEach((sTemp) => {
        sTemp._id = new mongoose.Types.ObjectId();
        splits.push(sTemp);
        sTemp.workouts.forEach((wTemp) => {
          wTemp._id = new mongoose.Types.ObjectId();
          workouts.push(wTemp);
          wTemp.exercises.forEach((ceTemp) => {
            wTemp._id = new mongoose.Types.ObjectId();
            customExercises.push(ceTemp);
            ceTemp.sets.forEach((sTemp) => {
              sTemp._id = new mongoose.Types.ObjectId();
              sets.push(sTemp);
            });
          });
        });
      });

      await setSchema.insertMany(sets);
      await customExerciseSchema.insertMany(customExercises);
      await workoutSchema.insertMany(workouts);
      await splitSchema.insertMany(splits);

      delete sharedTable._id;
      delete sharedTable.userId;
      sharedTable = await tableSchema.create(sharedTable);

      return `${serverDomain}/api/tables/share/${idUser}/${idTable}`;
    } catch (e) {
      throw e;
    }
  },

  async getSearchTables(page, limit, search, isOwn, idUser, defaultOnly = false) {
    try {
      const normalizedSearch = (search || "").trim();
      const searchTerms = normalizedSearch
        .split(" ")
        .map((term) => term.trim())
        .filter(Boolean);

      const baseMatch = {};

      if (searchTerms.length > 0) {
        baseMatch.$and = searchTerms.map((term) => ({
          name: { $regex: term, $options: "i" },
        }));
      }

      const buildLightSearchPipeline = (extraMatch = {}) => [
        { $match: { ...baseMatch, ...extraMatch } },
        { $project: { _id: 1, name: 1, urlImage: 1, splits: 1 } },
        {
          $lookup: {
            from: "splits",
            let: { splitIds: "$splits" },
            pipeline: [
              { $match: { $expr: { $in: ["$_id", "$$splitIds"] } } },
              { $project: { _id: 1, workoutsCount: { $size: "$workouts" } } },
            ],
            as: "splitStats",
          },
        },
        {
          $addFields: {
            microcyclesCount: { $size: "$splits" },
            workoutsCount: {
              $ifNull: [{ $arrayElemAt: ["$splitStats.workoutsCount", 0] }, 0],
            },
          },
        },
        {
          $project: {
            _id: 1,
            name: 1,
            urlImage: 1,
            microcyclesCount: 1,
            workoutsCount: 1,
          },
        },
        { $skip: page * limit },
        { $limit: limit },
      ];

      if (isOwn) {
        return await tableSchema.aggregate(
          buildLightSearchPipeline({ userId: mongoose.Types.ObjectId(idUser) })
        );
      }

      if (defaultOnly) {
        return await tableSchema.aggregate(
          buildLightSearchPipeline({ userId: { $exists: false } })
        );
      }

      // All routines: user's own + public templates
      return await tableSchema.aggregate(
        buildLightSearchPipeline({
          $or: [
            { userId: mongoose.Types.ObjectId(idUser) },
            { userId: { $exists: false } }
          ]
        })
      );
    } catch (e) {
      throw e;
    }
  },

  async createTable(table) {
    return tableSchema.create(table);
  },

  async createTableToUser(idUser, standardTable) {
    try {
      const tableDoc = await tableSchema.create({
        ...standardTable,
        userId: idUser,
      });
      const addTableToUser = {
        $set: { tableInUse: tableDoc._id },
        $unset: { workoutInUse: "" },
      };
      await userSchema.findByIdAndUpdate(idUser, addTableToUser);
      return tableDoc;
    } catch (err) {
      throw err;
    }
  },

  async updateTable(id, name, userId, adminMode = false) {
    const update = { $set: { name: name } };
    try {
      const query = adminMode ? { _id: id } : { _id: id, userId: userId };
      const docTable = await tableSchema.findOneAndUpdate(query, update, {
        new: true,
      });
      if (!docTable) throw new Error("Table not found or access denied");
      return { name: docTable.name };
    } catch (err) {
      throw err;
    }
  },

  async deleteTable(idUser, idTable, adminMode = false) {
    try {
      const query = adminMode ? { _id: idTable } : { _id: idTable, userId: idUser };
      return await tableSchema.deleteOne(query).exec();
    } catch (e) {
      throw e;
    }
  },

  async deleteTableSplit(idTable, idSplit) {
    const deleteSplit = {
      $pull: { splits: idSplit },
    };

    return tableSchema.findByIdAndUpdate(idTable, deleteSplit, {}).exec();
  },

  async countUserTables(userId) {
    return tableSchema.countDocuments({ userId }).exec();
  },

  // MVP-trainers D10: cuenta solo las rutinas SIN assignedByTrainerId — las
  // asignadas por un profesional no deben contar contra el límite FREE propio
  // del cliente. Ver table-service.js#countEffectiveUserTables para cuándo se
  // usa esta función vs. countUserTables (depende de si hay relación activa).
  async countOwnUserTables(userId) {
    return tableSchema.countDocuments({ userId, assignedByTrainerId: null }).exec();
  },

  async getExerciseHistoryStats(userId, exerciseId, exerciseName) {
    const { ObjectId } = require("mongoose").Types;

    function parseTimeToSeconds(timeStr) {
      if (!timeStr) return 0;
      const parts = String(timeStr).split(":");
      if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      }
      return parseInt(parts[0], 10) || 0;
    }

    const matchExercise = exerciseId
      ? { "exerciseInfo._id": ObjectId(exerciseId) }
      : { "exerciseInfo.name": exerciseName };

    const pipeline = [
      { $match: { userId: ObjectId(userId) } },
      { $lookup: { from: "splits", localField: "splits", foreignField: "_id", as: "splits" } },
      { $unwind: { path: "$splits", preserveNullAndEmptyArrays: false } },
      { $lookup: { from: "workouts", localField: "splits.workouts", foreignField: "_id", as: "workouts" } },
      { $unwind: { path: "$workouts", preserveNullAndEmptyArrays: false } },
      { $match: { $or: [{ "workouts.rest": { $ne: true } }, { "workouts.rest": { $exists: false } }] } },
      { $lookup: { from: "customexercises", localField: "workouts.exercises", foreignField: "_id", as: "customExercises" } },
      { $unwind: { path: "$customExercises", preserveNullAndEmptyArrays: false } },
      { $lookup: { from: "exercises", localField: "customExercises.exercise", foreignField: "_id", as: "exerciseInfo" } },
      { $unwind: { path: "$exerciseInfo", preserveNullAndEmptyArrays: true } },
      { $match: matchExercise },
      {
        $addFields: {
          exerciseType: {
            $cond: [{ $ifNull: ["$exerciseInfo.isIsometric", false] }, "isometric",
              { $cond: [{ $ifNull: ["$exerciseInfo.isCardio", false] }, "cardio", "strength"] }
            ]
          }
        }
      },
      { $lookup: { from: "sets", localField: "customExercises.sets", foreignField: "_id", as: "sets" } },
      { $unwind: { path: "$sets", preserveNullAndEmptyArrays: false } },
      { $match: { "sets.doned": true } },
      {
        $group: {
          _id: "$exerciseType",
          allSets: { $push: "$$ROOT" },
        }
      },
    ];

    const results = await tableSchema.aggregate(pipeline);

    if (results.length === 0) {
      return { exerciseId, exerciseName, exerciseType: "strength", bestSet: null, maxWeightEver: 0, bestVelocityEver: null, bestTimeEver: null, bestTimeSecondsEver: 0 };
    }

    const r = results[0];
    const exerciseType = r._id;

    let bestSet = null;
    let bestVolume = 0;
    let maxWeightEver = 0;
    let bestTimeSeconds = 0;
    let bestTimeStr = null;
    let bestVelocity = 0;

    for (const doc of r.allSets) {
      const s = doc.sets;
      if (exerciseType === "strength") {
        const candidates = [
          { weight: s.weight || 0, reps: s.reps || 0 },
          ...(s.dropSetSeries || []).map((cs) => ({
            weight: cs.weight || 0,
            reps: cs.reps || 0,
          })),
          ...(s.restPauseSeries || []).map((cs) => ({
            weight: cs.weight || 0,
            reps: cs.reps || 0,
          })),
        ];
        candidates.forEach((c) => {
          const volume = c.weight * c.reps;
          if (volume > bestVolume) {
            bestSet = { weight: c.weight, reps: c.reps };
            bestVolume = volume;
          }
          if (c.weight > maxWeightEver) maxWeightEver = c.weight;
        });
      } else if (exerciseType === "cardio") {
        const vel = s.velocity || 0;
        if (vel > bestVelocity) bestVelocity = vel;
      } else if (exerciseType === "isometric") {
        const secs = parseTimeToSeconds(s.time);
        if (secs > bestTimeSeconds) {
          bestTimeSeconds = secs;
          bestTimeStr = s.time || null;
        }
      }
    }

    return {
      exerciseId,
      exerciseName,
      exerciseType,
      bestSet,
      maxWeightEver,
      bestVelocityEver: exerciseType === "cardio" ? (bestVelocity || null) : null,
      bestTimeEver: exerciseType === "isometric" ? bestTimeStr : null,
      bestTimeSecondsEver: exerciseType === "isometric" ? bestTimeSeconds : 0,
    };
  },
};