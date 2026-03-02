const dietDayDao = require("./diet-days-dao");
const dietDayUtil = require("./diet-days-util");
const { archiveDietDay } = require("./diet-days-dao");
const aggregateService = require("../util/aggregate-service");

module.exports = {
  async getDietDays(page, limit) {
    return dietDayDao.findAll(page, limit);
  },

  // TODO: Revisar tema fechas
  async getDietDaysWeightsBetweenDatesByIdDiet(id, startDate, endDate) {
    const minDate = new Date(startDate);
    const maxDate = new Date(endDate);
    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(23, 59, 59, 59);
    const dietDays = await dietDayDao.getDietDaysWeightsBetweenDatesByIdDiet(
      id,
      minDate,
      maxDate,
    );
    return await aggregateService.aggregateFilter(dietDays, "dietDays");
  },

  // TODO: Revisar tema fechas
  async getDietDaysBetweenDatesByIdDiet(id, startDate, endDate) {
    const minDate = new Date(startDate);
    const maxDate = new Date(endDate);
    minDate.setHours(0, 0, 0, 0);
    maxDate.setHours(23, 59, 59, 59);
    const dietDays = await dietDayDao.getDietDaysBetweenDatesByIdDiet(
      id,
      minDate,
      maxDate,
    );
    return await aggregateService.aggregateFilter(dietDays, "dietDays");
  },

  async findByIdDietAndDate(id, date) {
    return dietDayDao.findByIdDietAndDate(id, date);
  },

  async createDietDay(dietDay) {
    return dietDayDao.createDietDay(dietDay);
  },

  async createDietDay(dietDay) {
    return dietDayDao.createDietDay(dietDay);
  },

  async createDayWeightOnNewDietDay(dayWeight, dietInUseId, currentDate) {
    let standarDietDay = dietDayUtil.getStandardDietDay(currentDate);
    return dietDayDao.createDayWeightOnNewDietDay(
      dayWeight,
      dietInUseId,
      standarDietDay,
    );
  },

  async createCustomProductOnNewDietDay(
    customProduct,
    indexMeal,
    dietInUseId,
    currentDate,
    idUser,
  ) {
    let standarDietDay = dietDayUtil.getStandardDietDay(currentDate);
    return dietDayDao.createCustomProductOnNewDietDay(
      customProduct,
      indexMeal,
      dietInUseId,
      standarDietDay,
      idUser,
    );
  },

  async createDataRecipeOnNewDietDay(
    dataRecipe,
    indexMeal,
    dietInUseId,
    currentDate,
  ) {
    let standarDietDay = dietDayUtil.getStandardDietDay(currentDate);
    return dietDayDao.createDataRecipeOnNewDietDay(
      dataRecipe,
      indexMeal,
      dietInUseId,
      standarDietDay,
    );
  },

  async createCustomRecipeOnNewDietDay(
    customRecipe,
    indexMeal,
    dietInUseId,
    currentDate,
  ) {
    let standarDietDay = dietDayUtil.getStandardDietDay(currentDate);
    return dietDayDao.createCustomRecipeOnNewDietDay(
      customRecipe,
      indexMeal,
      dietInUseId,
      standarDietDay,
    );
  },

  async createOwnCustomRecipeOnNewDietDay(
    idUser,
    customRecipe,
    currentDate,
    indexMeal,
  ) {
    let standarDietDay = dietDayUtil.getStandardDietDay(currentDate);
    return dietDayDao.createOwnCustomRecipeOnNewDietDay(
      idUser,
      customRecipe,
      standarDietDay,
      indexMeal,
    );
  },

  async createCustomRecipeInstanceOnNewDietDay(
    customRecipeInstance,
    indexMeal,
    dietInUseId,
    currentDate,
  ) {
    let standarDietDay = dietDayUtil.getStandardDietDay(currentDate);
    return dietDayDao.createCustomRecipeInstanceOnNewDietDay(
      customRecipeInstance,
      indexMeal,
      dietInUseId,
      standarDietDay,
    );
  },

  async addDietDayMeal(idDietDay, idMeal) {
    return dietDayDao.addDietDayMeal(idDietDay, idMeal);
  },

  async archiveDietDay(idUser, idDietDay) {
    return dietDayDao.archiveDietDay(idUser, idDietDay);
  },

  async updateDietDay(id, { name, weight, date, meals, notes }) {
    return dietDayDao.updateDietDay(id, { name, weight, date, meals, notes });
  },

  async pasteDietDayByIdDiet(id, dietDayClipboard, dietDayToPaste) {
    return dietDayDao.pasteDietDayByIdDiet(
      id,
      dietDayClipboard,
      dietDayToPaste,
    );
  },

  async deleteDietDay(idDiet, idDietDay) {
    return dietDayDao.deleteDietDay(idDiet, idDietDay);
  },

  async deleteDietDayMeal(id) {
    return dietDayDao.deleteDietDayMeal(id);
  },
};
