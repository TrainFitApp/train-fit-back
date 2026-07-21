const anthropometryModel = require("../anthropometry/anthropometry-service");
const dietDayModel = require("./diet-days-service");

const controller = {
  async getDietDays(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const dietDays = await dietDayModel.getDietDays(page, limit);
    return res.send(dietDays);
  },

  async getDietDaysBetweenDatesByIdDiet(req, res) {
    const dietDays = await dietDayModel.getDietDaysBetweenDatesByIdDiet(
      req.params.id,
      req.body.minDate,
      req.body.maxDate,
      req.user.id
    );
    return res.send(dietDays);
  },

  async getDietDayByIdDietAndDate(req, res) {
    const dietDay = await dietDayModel.findByIdDietAndDate(
      req.params.id,
      req.body.date,
    );
    
    // Also fetch anthropometry for this date
    const anthropometry = await anthropometryModel.getAnthropometryByUserIdAndDate(
      req.user.id,
      req.body.date
    );
    
    return res.send({ dietDay, anthropometry: anthropometry || null });
  },

  async createDietDay(req, res) {
    const dietDay = await dietDayModel.createDietDay({
      date: req.body.date,
      meals: req.body.meals,
    });

    return res.send(dietDay);
  },

  async createDayWeightOnNewDietDay(req, res) {
    const userId = req.user.id;
    const dietDay = await dietDayModel.createDayWeightOnNewDietDay(
      req.body.dayWeight,
      req.params.dietInUseId,
      req.body.currentDate,
      userId
    );
    
    // Also fetch the anthropometry that was just created
    const anthropometry = await anthropometryModel.getAnthropometryByUserIdAndDate(
      userId,
      req.body.currentDate
    );
    
    return res.send({ dietDay, anthropometry });
  },

  async createCustomProductOnNewDietDay(req, res) {
    const dietDay = await dietDayModel.createCustomProductOnNewDietDay(
      req.body.customProduct,
      req.body.indexMeal,
      req.params.dietInUseId,
      req.body.currentDate,
      req.body.idUser,
    );

    return res.send(dietDay);
  },

  async createCustomRecipeOnNewDietDay(req, res) {
    const dietDay = await dietDayModel.createCustomRecipeOnNewDietDay(
      req.body.customRecipe,
      req.body.indexMeal,
      req.params.dietInUseId,
      req.body.currentDate,
    );

    return res.send(dietDay);
  },

  async createOwnCustomRecipeOnNewDietDay(req, res) {
    const dietDay = await dietDayModel.createOwnCustomRecipeOnNewDietDay(
      req.params.idUser,
      req.body.customRecipe,
      req.body.date,
      req.body.indexMeal,
    );

    return res.send(dietDay);
  },

  async addDietDayMeal(req, res) {
    const dietDay = await dietDayModel.addDietDayMeal(
      req.params.idDietDay,
      req.params.idMeal,
    );

    return res.send(dietDay);
  },

  async updateDietDay(req, res) {
    const dietDay = await dietDayModel.updateDietDay(req.params.id, {
      notes: req.body.notes,
      date: req.body.date,
      meals: req.body.meals,
    });

    return res.send(dietDay);
  },

  async pasteDietDayByIdDiet(req, res) {
    const dietDay = await dietDayModel.pasteDietDayByIdDiet(
      req.params.id,
      req.body.dietDayClipboard,
      req.body.dietDayToPaste,
    );

    return res.send(dietDay);
  },

  async deleteDietDay(req, res) {
    await dietDayModel.deleteDietDay(req.params.idDiet, req.params.idDietDay);
    res.sendStatus(204);
  },

  async deleteDietDayMeal(req, res) {
    const dietDay = await dietDayModel.deleteDietDayMeal(
      req.params.iddietday,
      req.params.idmeal,
    );

    return res.send(dietDay);
  },
};

module.exports = controller;