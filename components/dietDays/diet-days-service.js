const dietDayDao = require("./diet-days-dao");
const dietDayUtil = require("./diet-days-util");
const aggregateService = require("../util/aggregate-service");
const anthropometryModel = require("../anthropometry/anthropometry-service");

module.exports = {
  async getDietDays(page, limit) {
    return dietDayDao.findAll(page, limit);
  },

  async getDietDaysBetweenDatesByIdDiet(id, startDate, endDate, userId) {
    const dietDays = await dietDayDao.getDietDaysBetweenDatesByIdDiet(
      id,
      startDate,
      endDate,
    );
    const aggregatedDietDays = await aggregateService.aggregateFilter(dietDays, "dietDays");
    
    // Also fetch anthropometry weights for this date range (using userId)
    const anthropometries = await anthropometryModel.getAnthropometriesByUserIdBetweenDates(
      userId,
      startDate,
      endDate
    );
    
    // Merge weights into existing dietDays and create virtual entries for anthropometry-only dates
    const anthropometryDateSet = new Set();
    anthropometries.forEach(a => {
      if (a.weight !== undefined) {
        anthropometryDateSet.add(a.date);
      }
    });
    
    const mergedDietDays = aggregatedDietDays.map(dietDay => {
      const weight = anthropometries.find(a => a.date === dietDay.date)?.weight;
      return {
        ...dietDay,
        weight: weight !== undefined ? weight : (dietDay.weight ?? null)
      };
    });
    
    // Add virtual diet days for anthropometry entries that don't have a diet day
    const dietDayDateSet = new Set(aggregatedDietDays.map(d => d.date));
    anthropometries.forEach(a => {
      if (a.weight !== undefined && !dietDayDateSet.has(a.date)) {
        mergedDietDays.push({
          _id: a._id,
          date: a.date,
          weight: a.weight,
          meals: [],
          notes: a.notes || '',
        });
      }
    });
    
    // Sort by date descending to match original order
    mergedDietDays.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    return mergedDietDays;
  },

  async findByIdDietAndDate(id, date) {
    return dietDayDao.findByIdDietAndDate(id, date);
  },

  async getFullyPopulatedDietDaysForDiet(dietId, startDate, endDate) {
    return dietDayDao.getFullyPopulatedDietDaysForDiet(dietId, startDate, endDate);
  },

  async countDaysWithoutChoice(dietId, startDate, endDate) {
    return dietDayDao.countDaysWithoutChoice(dietId, startDate, endDate);
  },

  async createDietDay(dietDay) {
    return dietDayDao.createDietDay(dietDay);
  },

  async createDayWeightOnNewDietDay(dayWeight, dietInUseId, currentDate, userId) {
    const standardDietDay = dietDayUtil.getStandardDietDay(currentDate);
    const dietDay = await dietDayDao.createDietDayOnNew(dietInUseId, standardDietDay);

    if (dayWeight && userId) {
      await anthropometryModel.upsertAnthropometry(userId, currentDate, { weight: dayWeight });
      dietDay.weight = dayWeight;
    }

    return dietDay;
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

  async addDietDayMeal(idDietDay, idMeal) {
    return dietDayDao.addDietDayMeal(idDietDay, idMeal);
  },

  async updateDietDay(id, { name, date, meals, notes }) {
    return dietDayDao.updateDietDay(id, { name, date, meals, notes });
  },

  async setDayTypeName(dietDayId, dayTypeName) {
    return dietDayDao.setDayTypeName(dietDayId, dayTypeName);
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
