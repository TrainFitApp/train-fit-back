const dietModel = require("./diet-model");

module.exports = {

  async getDiets(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);

    const diets = await dietModel.getDiets(page, limit, req.params.search);

    return res.send(diets);
  },

  async getDietById(req, res) {

    const diet = await dietModel.getDietById(req.params.id);

    return res.send(diet);
  },

  async getSearchDiets(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const diets = await dietModel.getSearchDiets(
      page,
      limit,
      req.body.search
    );
    return res.send(diets);
  },

  async createDiet(req, res) {
    const diet = await dietModel.createDiet({
      name: req.body.name,
      dietsDay: req.body.dietsDay,
    });

    return res.send(diet);
  },

  async addDietDietDay(req, res) {
    const diet = await dietModel.addDietDietDay(
      req.params.idDiet,
      req.params.idDietDay
    );

    return res.send(diet);
  },

  async addDietUser(req, res) {
    const diet = await dietModel.addDietUser(
      req.params.idUser,
      req.params.idDiet
    );

    return res.send(diet);
  },

  async updateDiet(req, res) {
    if (!req.body.name) return res.sendStatus(400);
    if (!req.body.dietDays) return res.sendStatus(400);
    const diet = await dietModel.getUser(req.params.id);
    if (!diet) return res.sendStatus(404);

    await dietModel.updateDiet(req.params.id, {
      name: req.body.username,
      dietsDay: req.body.dietsDay,
    });

    return res.sendStatus(204);
  },

  async deleteDiet(req, res) {
    await dietModel.deleteDiet(req.params.id);
    res.sendStatus(204);
  },

  async deleteDietDietDay(req, res) {
    const diet = await dietModel.deleteDietDietDay(
      req.params.iddiet,
      req.params.iddietday
    );

    return res.send(diet);
  },

  async updatePinnedNote(req, res) {
    const { id } = req.params;
    const { notes } = req.body;

    if (typeof notes !== "string") {
      return res.status(400).json({ success: false, message: "Notes must be a string" });
    }

    const diet = await dietModel.updatePinnedNote(id, notes.trim());
    return res.send(diet);
  },

};
