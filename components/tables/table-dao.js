const tableSchema = require("./table-schema");
const userSchema = require("../users/schema");
const ownTableSchema = require("../ownTables/own-table-schema");
const { default: mongoose } = require("mongoose");
const splitSchema = require("../splits/split-schema");
const setSchema = require("../sets/set-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");
const workoutSchema = require("../workouts/workout-schema");
const serverDomain = process.env.SERVER_DOMAIN;

module.exports = {
  async getTables(page, limit) {
    return new Promise((resolve, reject) =>
      tableSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        })
    );
  },

  async getTableById(id) {
    return new Promise((resolve, reject) =>
      ownTableSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
  },

  async copySharedTable(idUser, idTable) {
    try {
      const splits = [],
        workouts = [],
        customExercises = [],
        sets = [];

      let sharedTable = await ownTableSchema.findById(idTable);
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
      sharedTable = await tableSchema.create(sharedTable);

      const addTableToUserQuery = { $push: { ownTables: sharedTable._id } };

      await userSchema.findByIdAndUpdate(idUser, addTableToUserQuery, {
        new: true,
      });

      return `${serverDomain}/api/tables/share/${idUser}/${idTable}`;
    } catch (e) {
      throw err;
    }
  },

  async getSearchTables(page, limit, search, isOwn, idUser) {
    try {
      const searchTerms = search.split(" ");

      if (isOwn) {
        const userId = mongoose.Types.ObjectId(idUser);

        const user = await userSchema.findById(userId);

        if (!user) {
          // Manejo de usuario no encontrado
          return [];
        }

        // Luego, obtén los IDs de las tablas del usuario
        const tableIds = user.ownTables.map((tableTemp) => tableTemp._id); // Asume que este es el campo que contiene los IDs de las tablas

        // Define un arreglo para almacenar las condiciones de búsqueda
        const searchConditions = [];

        // Agrega las condiciones de búsqueda para cada término en `searchTerms`
        searchTerms.forEach((term) => {
          searchConditions.push({
            name: { $regex: term, $options: "i" },
          });
        });

        // Combina todas las condiciones con $and
        searchConditions.unshift({ _id: { $in: tableIds } });

        // Utiliza las condiciones de búsqueda para buscar las tablas
        return await ownTableSchema
          .find({ $and: searchConditions })
          .skip(page * limit)
          .limit(limit);
      } else {
        const aggregate = [
          {
            $match: {
              name: { $regex: search, $options: "i" },
            },
          },
          {
            $lookup: {
              from: "splits",
              localField: "splits",
              foreignField: "_id",
              as: "splits",
            },
          },
          {
            $skip: page * limit,
          },
          {
            $limit: limit,
          },
        ];
        return await tableSchema.aggregate(aggregate);
      }
    } catch (e) {
      throw err;
    }
  },

  async createTable(table) {
    return new Promise((resolve, reject) =>
      tableSchema.create(table, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
  },

  async createTableToUser(idUser, standardTable) {
    try {
      const tableDoc = await tableSchema.create(standardTable);
      const addTableToUser = { 
        $set: { tableInUse: tableDoc._id },
        $unset: { workoutInUse: "" }
      };
      await userSchema.findByIdAndUpdate(idUser, addTableToUser);
      return tableDoc;
    } catch (err) {
      throw err;
    }
  },

  async updateTable(id, name) {
    const update = { $set: { name: name } };
    try {
      const docTable = await ownTableSchema.findByIdAndUpdate(id, update, {
        new: true,
      });
      return { name: docTable.name };
    } catch (err) {
      throw err;
    }
  },

  async deleteTable(id) {
    return new Promise((resolve, reject) =>
      tableSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async deleteTableSplit(idTable, idSplit) {
    const deleteSplit = {
      $pull: { splits: idSplit },
    };

    return new Promise((resolve, reject) =>
      tableSchema.findByIdAndUpdate(idTable, deleteSplit, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },
};
