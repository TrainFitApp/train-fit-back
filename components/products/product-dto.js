const single = (resource, authUser) => ({
  code: resource.code,
  brand: resource.brand,
  name: resource.name,
  calcium100g: resource.calcium100g,
  carbohydrates100g: resource.carbohydrates100g,
  cholesterol100g: resource.cholesterol100g,
  energyKcal100g: resource.energyKcal100g,
  fat100g: resource.fat100g,
  fiber100g: resource.fiber100g,
  iron100g: resource.iron100g,
  protein100g: resource.protein100g,
  salt100g: resource.salt100g,
  saturatedFat100g: resource.saturatedFat100g,
  sodium100g: resource.sodium100g,
  sugars100g: resource.sugars100g,
  transFat100g: resource.transFat100g,
  vitaminA100g: resource.vitaminA100g,
  vitaminC100g: resource.vitaminC100g,
  nutriscoreScore: resource.nutriscoreScor,
  nutriscoreGrade: resource.nutriscoreGrade,
  productQuantity: resource.productQuantity
    ? resource.productQuantity
    : undefined,
  servingQuantity: resource.servingQuantity,
  verified: resource.verified,
});

const multiple = (resources, authUser) =>
  resources.map((resource) => single(resource, authUser));

module.exports = {
  single,
  multiple,
};
