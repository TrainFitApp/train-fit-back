const mongoose = require("mongoose");
const { buildSearchFields } = require("../util/search-index");
const Schema = mongoose.Schema;

const ProductSchema = Schema({
  code: { type: String, trim: true, maxlength: 100 },
  name: { type: String, trim: true, maxlength: 300 },
  brand: { type: String, trim: true, maxlength: 200 },
  // Campos derivados para la búsqueda (components/util/search-index.js).
  // `searchTokens` sustituye a los antiguos namePrefixes/brandPrefixes: ver
  // ahí por qué guardar todos los prefijos no escalaba.
  nameNormalized: String,
  brandNormalized: String,
  searchTokens: [String],

  // Basic macronutrients (min/max: techo genérico de seguridad, no específico por nutriente)
  calcium100g: { type: Number, min: 0, max: 100000 },
  carbohydrates100g: { type: Number, min: 0, max: 100000 },
  cholesterol100g: { type: Number, min: 0, max: 100000 },
  energyKcal100g: { type: Number, min: 0, max: 100000 },
  fat100g: { type: Number, min: 0, max: 100000 },
  fiber100g: { type: Number, min: 0, max: 100000 },
  iron100g: { type: Number, min: 0, max: 100000 },
  protein100g: { type: Number, min: 0, max: 100000 },
  salt100g: { type: Number, min: 0, max: 100000 },
  saturatedFat100g: { type: Number, min: 0, max: 100000 },
  sodium100g: { type: Number, min: 0, max: 100000 },
  sugars100g: { type: Number, min: 0, max: 100000 },
  transFat100g: { type: Number, min: 0, max: 100000 },
  vitaminA100g: { type: Number, min: 0, max: 100000 },
  vitaminC100g: { type: Number, min: 0, max: 100000 },

  // Additional minerals (stored in grams, displayed in mg/µg)
  magnesium100g: { type: Number, min: 0, max: 100000 },
  phosphorus100g: { type: Number, min: 0, max: 100000 },
  potassium100g: { type: Number, min: 0, max: 100000 },
  zinc100g: { type: Number, min: 0, max: 100000 },
  copper100g: { type: Number, min: 0, max: 100000 },
  manganese100g: { type: Number, min: 0, max: 100000 },
  selenium100g: { type: Number, min: 0, max: 100000 },
  iodine100g: { type: Number, min: 0, max: 100000 },

  // Additional vitamins (stored in grams, displayed in mg/µg)
  vitaminB1100g: { type: Number, min: 0, max: 100000 }, // Thiamin
  vitaminB2100g: { type: Number, min: 0, max: 100000 }, // Riboflavin
  vitaminB3100g: { type: Number, min: 0, max: 100000 }, // Niacin
  vitaminB5100g: { type: Number, min: 0, max: 100000 }, // Pantothenic acid
  vitaminB6100g: { type: Number, min: 0, max: 100000 },
  vitaminB9100g: { type: Number, min: 0, max: 100000 }, // Folate
  vitaminB12100g: { type: Number, min: 0, max: 100000 },
  vitaminD100g: { type: Number, min: 0, max: 100000 },
  vitaminE100g: { type: Number, min: 0, max: 100000 },
  vitaminK100g: { type: Number, min: 0, max: 100000 },
  biotin100g: { type: Number, min: 0, max: 100000 }, // Vitamin B7

  // Fatty acids (in grams)
  omega3100g: { type: Number, min: 0, max: 100000 },
  omega6100g: { type: Number, min: 0, max: 100000 },
  omega9100g: { type: Number, min: 0, max: 100000 },

  // Other nutrients
  caffeine100g: { type: Number, min: 0, max: 100000 },
  taurine100g: { type: Number, min: 0, max: 100000 },
  alcohol100g: { type: Number, min: 0, max: 100000 },

  // Product information
  servingUnit: String,
  ingredients: { type: String, trim: true, maxlength: 5000 },

  // Allergens and dietary characteristics
  allergens: {
    type: [String],
    validate: {
      validator: (arr) => !arr || arr.every((s) => (s || "").trim().length <= 200),
      message: "Cada alérgeno debe tener 200 caracteres o menos",
    },
  },
  traces: {
    type: [String],
    validate: {
      validator: (arr) => !arr || arr.every((s) => (s || "").trim().length <= 200),
      message: "Cada traza debe tener 200 caracteres o menos",
    },
  },
  vegan: Boolean,
  vegetarian: Boolean,
  lactoseFree: Boolean,
  glutenFree: Boolean,

  // Nutriscore & serving
  nutriscoreScore: Number,
  nutriscoreGrade: String,
  productQuantity: Number,
  servingQuantity: Number,
  verified: Boolean,

  // Owner: if set, this product was created by the user (replaces OwnProduct)
  userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
});

// ─── INDEXES ───────────────────────────────────────────────────────────
// Los índices de products los gestiona scripts/rebuild-search-indexes.js.
// Ejecutar:  npm run rebuild:search-indexes
// NO declarar índices aquí — el script es la fuente única de verdad.
// ───────────────────────────────────────────────────────────────────────

// ─── Campos derivados de búsqueda ──────────────────────────────────────
// Se calculan en el schema, no en el DAO, porque un producto se crea desde
// varios sitios: /api/products, el alta en línea al añadir un alimento a una
// comida (customProducts/custom-product-dao.js) y los scripts de semilla. Si
// alguno se olvida de rellenarlos, ese producto no aparece NUNCA en la
// búsqueda — y eso es exactamente lo que pasaba con los productos creados
// desde la app y con cualquier producto al que se le editaran solo las
// macros (el $unset genérico de updateProduct se los llevaba por delante).

ProductSchema.pre("save", function syncSearchFieldsOnSave(next) {
  if (this.isModified("name") || this.isModified("brand") || !this.nameNormalized) {
    Object.assign(this, buildSearchFields({ name: this.name, brand: this.brand }));
  }
  next();
});

async function syncSearchFieldsOnUpdate() {
  const update = this.getUpdate() || {};
  if (Array.isArray(update)) return; // pipeline de agregación: no lo usamos

  const set = update.$set || {};
  const unset = update.$unset || {};
  const touchesName =
    Object.prototype.hasOwnProperty.call(set, "name") ||
    Object.prototype.hasOwnProperty.call(update, "name") ||
    Object.prototype.hasOwnProperty.call(unset, "name");
  const touchesBrand =
    Object.prototype.hasOwnProperty.call(set, "brand") ||
    Object.prototype.hasOwnProperty.call(update, "brand") ||
    Object.prototype.hasOwnProperty.call(unset, "brand");

  if (!touchesName && !touchesBrand) return;

  const pick = (field) => {
    if (Object.prototype.hasOwnProperty.call(set, field)) return set[field];
    if (Object.prototype.hasOwnProperty.call(update, field)) return update[field];
    if (Object.prototype.hasOwnProperty.call(unset, field)) return "";
    return undefined;
  };

  // `searchTokens` mezcla nombre y marca: si solo cambia uno, hace falta leer
  // el otro del documento actual.
  let name = pick("name");
  let brand = pick("brand");

  if (name === undefined || brand === undefined) {
    const current = await this.model
      .findOne(this.getQuery())
      .select("name brand")
      .lean();
    if (name === undefined) name = current?.name;
    if (brand === undefined) brand = current?.brand;
  }

  const derived = buildSearchFields({ name, brand });
  const nextUpdate = { ...update, $set: { ...set, ...derived } };

  if (nextUpdate.$unset) {
    nextUpdate.$unset = { ...nextUpdate.$unset };
    Object.keys(derived).forEach((field) => delete nextUpdate.$unset[field]);
    if (!Object.keys(nextUpdate.$unset).length) delete nextUpdate.$unset;
  }

  this.setUpdate(nextUpdate);
}

ProductSchema.pre("findOneAndUpdate", syncSearchFieldsOnUpdate);
ProductSchema.pre("updateOne", syncSearchFieldsOnUpdate);

// ─── Shared cascade logic (single | bulk) ──────────────────────────────
async function cascadeDeleteProducts(productIds) {
  if (!productIds.length) return;

  // Remove from archivedProducts in users that have them favorited
  try {
    const UserModel = mongoose.model("User");
    await UserModel.updateMany(
      { archivedProducts: { $in: productIds } },
      { $pull: { archivedProducts: { $in: productIds } } },
    );
  } catch (e) {
    console.warn("[ProductSchema] Error updating archivedProducts", e);
  }

  // Clean up CustomProducts referencing any of these products
  try {
    const customProductSchema = require("../customProducts/custom-product-schema");
    let customProducts = await customProductSchema
      .find({ product: { $in: productIds } })
      .lean();

    if (customProducts.length > 0) {
      let cpIds = customProducts.map((cp) => cp._id);
      const dependentCustomProducts = await customProductSchema
        .find({ baseCustomProductId: { $in: cpIds } })
        .lean();

      if (dependentCustomProducts.length > 0) {
        customProducts = customProducts.concat(dependentCustomProducts);
        cpIds = customProducts.map((cp) => cp._id);
      }

      try {
        const MealModel = mongoose.model("Meal");
        await MealModel.updateMany(
          { customProducts: { $in: cpIds } },
          { $pull: { customProducts: { $in: cpIds } } },
        );
      } catch (e) {
        console.warn("[ProductSchema] Error updating meals", e);
      }
      // Las plantillas de dieta guardan los CustomProduct en arrays
      // ANIDADOS (menus[].meals[].alternatives[].customProducts). Sin esto
      // quedaba una ref a un CustomProduct ya borrado: autopopulate la
      // devuelve como null, el constructor no puede pintarla y al guardar la
      // plantilla ese alimento desaparecía sin avisar.
      try {
        const DietTemplateModel = mongoose.model("DietTemplate");
        await DietTemplateModel.updateMany(
          { "menus.meals.alternatives.customProducts": { $in: cpIds } },
          { $pull: { "menus.$[].meals.$[].alternatives.$[].customProducts": { $in: cpIds } } },
        );
      } catch (e) {
        console.warn("[ProductSchema] Error updating diet templates", e);
      }
      try {
        const RecipeModel = mongoose.model("Recipe");
        await RecipeModel.updateMany(
          { customProducts: { $in: cpIds } },
          { $pull: { customProducts: { $in: cpIds } } },
        );
      } catch (e) {
        console.warn("[ProductSchema] Error updating recipes", e);
      }
      try {
        const CustomRecipeModel = mongoose.model("CustomRecipe");
        await CustomRecipeModel.updateMany(
          {
            $or: [
              { addedCustomProducts: { $in: cpIds } },
              { modifiedBaseCustomProducts: { $in: cpIds } },
              { removedBaseCustomProductIds: { $in: cpIds } },
            ],
          },
          {
            $pull: {
              addedCustomProducts: { $in: cpIds },
              modifiedBaseCustomProducts: { $in: cpIds },
              removedBaseCustomProductIds: { $in: cpIds },
            },
          },
        );
      } catch (e) {
        console.warn("[ProductSchema] Error cleaning CustomRecipes", e);
      }
      await customProductSchema.deleteMany({ _id: { $in: cpIds } });
    }

    // Legacy cleanup for CustomRecipes with embedded added ingredients.
    try {
      const CustomRecipeModel = mongoose.model("CustomRecipe");
      await CustomRecipeModel.updateMany(
        { addedCustomProducts: { $elemMatch: { product: { $in: productIds } } } },
        { $pull: { addedCustomProducts: { product: { $in: productIds } } } },
      );
    } catch (e) {
      console.warn("[ProductSchema] Error cleaning addedCustomProducts", e);
    }
  } catch (e) {
    console.warn("[ProductSchema] Error cleaning up CustomProducts", e);
  }
}

// ─── Hooks ─────────────────────────────────────────────────────────────
const handleDeleteOne = async function (next) {
  try {
    const query = this.getQuery();
    const product = await this.model.findOne(query);
    if (!product) return next();
    await cascadeDeleteProducts([product._id]);
    next();
  } catch (error) {
    next(error);
  }
};

const handleDeleteMany = async function (next) {
  try {
    const query = this.getQuery();
    const products = await this.model.find(query).lean();
    if (!products.length) return next();
    await cascadeDeleteProducts(products.map((p) => p._id));
    next();
  } catch (error) {
    next(error);
  }
};

ProductSchema.pre("deleteOne", handleDeleteOne);
ProductSchema.pre("findOneAndDelete", handleDeleteOne);
ProductSchema.pre("findOneAndRemove", handleDeleteOne);
ProductSchema.pre("deleteMany", handleDeleteMany);

module.exports = mongoose.model("Product", ProductSchema);
