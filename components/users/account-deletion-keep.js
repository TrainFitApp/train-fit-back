const mongoose = require("mongoose");
const { addDaysToIsoDate, todayIsoDate } = require("../util/date-util");

// Lo que una cuenta deja en las cuentas de OTROS no se borra con ella
// (decisión 2026-10). Lo usa el hook de borrado de components/users/schema.js
// ANTES de su cascada: la cascada de Product borra los CustomProduct que lo
// usan, y la de DietTemplate por trainerId se llevaba las fases asignadas a
// los clientes. El caso de verdad es el entrenador que se va: sus clientes
// perdían comidas de su historial, sus fases de dieta y sus rutinas
// desaparecían de "Mis rutinas".

// Lo que una adición rápida necesita para pintarse y sumar sin su Product
// (diet-days-nutrition-util lee `cp.campo ?? cp.product?.campo`).
const CUSTOM_PRODUCT_SNAPSHOT_FIELDS = [
  "energyKcal100g", "protein100g", "carbohydrates100g", "fat100g", "saturatedFat100g",
  "sugars100g", "fiber100g", "salt100g", "sodium100g", "cholesterol100g", "transFat100g",
  "calcium100g", "iron100g", "magnesium100g", "phosphorus100g", "potassium100g", "zinc100g",
  "copper100g", "manganese100g", "selenium100g", "iodine100g", "vitaminA100g", "vitaminC100g",
  "vitaminD100g", "vitaminE100g", "vitaminK100g", "vitaminB1100g", "vitaminB2100g",
  "vitaminB3100g", "vitaminB5100g", "vitaminB6100g", "vitaminB9100g", "vitaminB12100g",
  "biotin100g", "omega3100g", "omega6100g", "omega9100g", "caffeine100g", "taurine100g",
  "alcohol100g", "ingredients", "allergens", "traces", "vegan", "vegetarian", "lactoseFree",
  "glutenFree",
];

// Cada CustomProduct que usa un alimento del usuario se convierte en una
// adición rápida: se queda con el nombre y los valores de ese momento (lo
// que el CustomProduct ya sobrescribía manda) y pierde la referencia, así que
// la cascada de Product ya no lo encuentra. Afecta también a los del propio
// usuario, que se borran después con su día, su snippet o su plantilla.
async function detachCustomProductsFromOwnProducts(userId) {
  const Product = mongoose.model("Product");
  const CustomProduct = mongoose.model("CustomProduct");
  const products = await Product.find({ userId }).lean();
  for (const product of products) {
    const keepOr = (field) => ({ $ifNull: [`$${field}`, { $literal: product[field] }] });
    const snapshot = { quickAdd: true, name: keepOr("name") };
    for (const field of CUSTOM_PRODUCT_SNAPSHOT_FIELDS) {
      if (product[field] !== undefined && product[field] !== null) snapshot[field] = keepOr(field);
    }
    await CustomProduct.updateMany({ product: product._id }, [{ $set: snapshot }, { $unset: "product" }]);
  }
}

// Recetas del usuario que alguien tiene en su diario o en una plantilla: se
// conservan sin dueño y sin verificar (la búsqueda no las enseña a nadie, pero
// las CustomRecipe que las usan siguen pintándose). Las demás las borra la
// cascada de siempre.
async function orphanUsedRecipes(userId) {
  const Recipe = mongoose.model("Recipe");
  const CustomRecipe = mongoose.model("CustomRecipe");
  const recipeIds = await Recipe.find({ userId }).distinct("_id");
  if (!recipeIds.length) return;
  const used = await CustomRecipe.distinct("recipe", { recipe: { $in: recipeIds } });
  if (!used.length) return;
  await Recipe.updateMany({ _id: { $in: used } }, { $unset: { userId: "" }, $set: { verified: false } });
}

// Fases de dieta que el entrenador asignó a sus clientes: las que ya habían
// empezado se quedan como historial terminado (ayer como último día, sin
// entrenador); las que empiezan hoy o más adelante no llegaron a correr y se
// borran.
async function endAssignedDietPhases(trainerId) {
  const DietTemplate = mongoose.model("DietTemplate");
  const yesterday = addDaysToIsoDate(todayIsoDate(), -1);
  const clientCopies = { trainerId, clientId: { $nin: [null, trainerId] } };
  await DietTemplate.deleteMany({ ...clientCopies, startDate: { $gt: yesterday } });
  await DietTemplate.updateMany(clientCopies, [
    {
      $set: {
        status: "ended",
        trainerId: null,
        endDate: {
          $cond: [
            { $or: [{ $eq: [{ $ifNull: ["$endDate", null] }, null] }, { $gt: ["$endDate", yesterday] }] },
            yesterday,
            "$endDate",
          ],
        },
      },
    },
  ]);
}

// Rutinas que el entrenador asignó a sus clientes: pasan a ser del cliente
// (sin la marca de asignada). Si no, al borrar sus RoutineAssignment
// desaparecían de "Mis rutinas" y quedaban bloqueadas para siempre.
async function releaseAssignedTables(trainerId) {
  await mongoose.model("Table").updateMany(
    { assignedByTrainerId: trainerId, userId: { $ne: trainerId } },
    { $unset: { assignedByTrainerId: "" } },
  );
}

async function keepOtherUsersData(userId) {
  await detachCustomProductsFromOwnProducts(userId);
  await orphanUsedRecipes(userId);
  await endAssignedDietPhases(userId);
  await releaseAssignedTables(userId);
}

module.exports = { keepOtherUsersData };
