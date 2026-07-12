const dietSchema = require("./diet-schema");
const userSchema = require("../users/schema");

module.exports = {
  async getDiets(page, limit) {
    return new Promise((resolve, reject) =>
      dietSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        })
    );
  },

  async getDietById(id) {
    return new Promise((resolve, reject) =>
      dietSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
  },

  async getSearchDiets(page, limit, search) {
    return new Promise((resolve, reject) =>
      dietSchema
        .find({ name: { $regex: search, $options: "i" } })
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        })
    );
  },

  async createDiet(diet) {
    return new Promise((resolve, reject) =>
      dietSchema.create(diet, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
  },

  async addDietDietDay(idDiet, idDietDay) {
    const addDietDay = {
      $push: { dietsDay: idDietDay },
    };

    return new Promise((resolve, reject) =>
      dietSchema.findByIdAndUpdate(
        idDiet,
        addDietDay,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }
      )
    );
  },

  async addDietUser(idUser, idDiet) {
    const addDiet = {
      $push: { diets: idDiet },
    };

    return new Promise((resolve, reject) =>
      userSchema.findByIdAndUpdate(idUser, addDiet, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async updateDiet(id, { name, dietsDay }) {
    const update = { $set: { name, dietsDay } };

    return new Promise((resolve, reject) =>
      dietSchema.updateOne({ _id: id }, update, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async updatePinnedNote(id, notes) {
    const update = notes
      ? { $set: { pinnedNote: notes } }
      : { $unset: { pinnedNote: "" } };

    return new Promise((resolve, reject) =>
      dietSchema.findByIdAndUpdate(id, update, { new: true }, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      })
    );
  },

  async deleteUser(id) {
    return new Promise((resolve, reject) =>
      dietSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async deleteDietDietDay(idDiet, idDietDay) {
    const deleteDietDay = {
      $pull: { dietDays: idDietDay },
    };

    return new Promise((resolve, reject) =>
      dietSchema.findByIdAndUpdate(idDiet, deleteDietDay, {}, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      })
    );
  },

  async deleteDiet(id) {
    try {
      return await dietSchema.deleteOne({ _id: id });
    } catch (err) {
      throw err;
    }
  },
};
