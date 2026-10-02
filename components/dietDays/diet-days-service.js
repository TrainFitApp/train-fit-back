const dietDayDao = require("./diet-days-dao");
const anthropometryModel = require("../anthropometry/anthropometry-service");
const dietTemplateDao = require("../dietTemplates/diet-template-dao");
const { buildShoppingList } = require("./shopping-list-service");

module.exports = {
  async getDietDays(page, limit) {
    return dietDayDao.findAll(page, limit);
  },

  async getDietDaysBetweenDatesByUser(userId, startDate, endDate) {
    // El DAO ya devuelve la lista de días directamente (antes venía envuelta
    // en [{dietDays:[...]}] porque la agregación arrancaba en el wrapper
    // Diet), así que ya no hace falta aggregateFilter para desenvolverla.
    const aggregatedDietDays = await dietDayDao.getDietDaysBetweenDatesByUser(
      userId,
      startDate,
      endDate,
    );
    
    // Also fetch anthropometry weights for this date range (using userId).
    // Solo lo que apuntó el cliente: lo de check-ins no sale en su calendario.
    const anthropometries = await anthropometryModel.getAnthropometriesByUserIdBetweenDates(
      userId,
      startDate,
      endDate,
      { ownOnly: true }
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

  async findByUserAndDate(userId, date) {
    return dietDayDao.findByUserAndDate(userId, date);
  },

  async getFullyPopulatedDietDaysForUser(userId, startDate, endDate) {
    return dietDayDao.getFullyPopulatedDietDaysForUser(userId, startDate, endDate);
  },

  // Lista de la compra del cliente para [from, to]: sale del plan, no de los
  // días materializados (ver shopping-list-service.js). La comparten la ruta
  // del cliente y la del entrenador.
  async getShoppingList(userId, from, to) {
    const [plans, marks] = await Promise.all([
      dietTemplateDao.listCoveringRange(userId, from, to),
      dietDayDao.listMenuMarks(userId, from, to),
    ]);
    return { ...buildShoppingList({ from, to, plans, marks }), period: { from, to } };
  },

  async countDaysWithoutChoice(userId, startDate, endDate) {
    return dietDayDao.countDaysWithoutChoice(userId, startDate, endDate);
  },

  // Crear o recuperar el día de una fecha. Idempotente — ver
  // diet-days-dao.js#ensureDietDay. Devuelve { dietDay, created }: `created`
  // lo necesita el resolver para decidir si toca aplicar el plan activo.
  async ensureDietDay(userId, date) {
    return dietDayDao.ensureDietDay(userId, date);
  },

  async setDayWeight(userId, date, dayWeight) {
    return anthropometryModel.upsertAnthropometry(userId, date, { weight: dayWeight });
  },

  async addCustomProductToMeal(dietDay, indexMeal, customProduct, userId) {
    return dietDayDao.addCustomProductToMeal(dietDay, indexMeal, customProduct, userId);
  },

  async addCustomRecipeToMeal(dietDay, indexMeal, customRecipe) {
    return dietDayDao.addCustomRecipeToMeal(dietDay, indexMeal, customRecipe);
  },

  async addDietDayMeal(idDietDay, idMeal) {
    return dietDayDao.addDietDayMeal(idDietDay, idMeal);
  },

  async setNotes(userId, date, notes) {
    return dietDayDao.setNotes(userId, date, notes);
  },

  async setMenuName(dietDayId, menuName) {
    return dietDayDao.setMenuName(dietDayId, menuName);
  },

  async pasteDietDayByUser(userId, dietDayClipboard, dietDayToPaste) {
    return dietDayDao.pasteDietDayByUser(
      userId,
      dietDayClipboard,
      dietDayToPaste,
    );
  },

  async deleteDietDay(idDietDay, userId) {
    return dietDayDao.deleteDietDay(idDietDay, userId);
  },
};
