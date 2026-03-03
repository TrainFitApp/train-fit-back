const setSchema = require("./set-schema");
const mealSchema = require("../meals/meal-schema");
const customExerciseSchema = require("../customExercises/custom-exercise-schema");

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
    return new Promise((resolve, reject) =>
      setSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },
};
