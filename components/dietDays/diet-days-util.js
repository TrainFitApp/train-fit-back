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
    // Handle null or undefined values
    if (!first || !second) {
      return false;
    }

    const firstDate = new Date(first);
    const secondDate = new Date(second);

    // Check if dates are valid
    if (isNaN(firstDate.getTime()) || isNaN(secondDate.getTime())) {
      return false;
    }

    return (
      firstDate.getFullYear() === secondDate.getFullYear() &&
      firstDate.getMonth() === secondDate.getMonth() &&
      firstDate.getDate() === secondDate.getDate()
    );
  },
};
