const MEALS = {
  0: "Desayuno",
  1: "Almuerzo",
  2: "Comida",
  3: "Merienda",
  4: "Cena",
  5: "Recena",
};

module.exports = {
  MEALS,

  getStandardDietDay(date) {
    let dietDay = {};
    dietDay.date = date;
    dietDay.meals = [];

    for (let i = 0; i < 6; i++) {
      let meal = {};
      meal.name = MEALS[i];
      meal.customProducts = [];
      meal.customRecipes = [];
      dietDay.meals.push(meal);
    }

    return dietDay;
  },

  datesAreOnSameDay(first, second) {
    if (!first || !second) return false;
    return first === second;
  },
};
