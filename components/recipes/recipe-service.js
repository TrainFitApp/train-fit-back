const mongoose = require("mongoose");
const recipeDao = require("./recipe-dao");
const recipeMerge = require("./recipe-merge");
const favoritesDao = require("../favorites/favorites-dao");
const productDao = require("../products/product-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const mealStore = require("../meals/meal-store");
const mealService = require("../meals/meal-service");
const dietDayDao = require("../dietDays/diet-days-dao");
const { resolveOwnedDietDay, resolveOwnedMealById } = require("../dietDays/diet-day-resolver");
const { patchCustomProduct } = require("../customProducts/custom-product-patch");
const { OVERRIDE_FIELDS } = require("../customRecipes/custom-recipe-builder");
const featureAccess = require("../billing/feature-access");
const { badRequest, forbidden, notFound } = require("../util/http-error");

// Recetas (recipe-schema.js): su contenido, ponerlas en platos y borrarlas
// sin arrancarlas del historial de nadie.

function normalizeCustomProductId(value) {
  const normalizedValue = value?._id || value;
  return normalizedValue?.toString?.() || null;
}

function buildCustomProductPayload(cpData) {
  return recipeMerge.sanitizeCustomProductData(cpData, { includeProduct: true, includeId: true });
}

// Ingredientes EMBEBIDOS en la receta (2026-10). Devuelve la lista nueva:
// los que ya existían (mismo _id) conservan su id y guardan solo lo que
// difiere de su Product; los nuevos reciben id nuevo; los que no llegan
// desaparecen.
async function syncRecipeCustomProducts(nextCustomProducts, currentCustomProducts = []) {
  const currentById = new Map(
    (currentCustomProducts || []).map((item) => [normalizeCustomProductId(item), item]),
  );
  const productIds = [...currentById.values()].map((item) => item?.product).filter(Boolean);
  const products = productIds.length
    ? await productDao.findManyByIds(productIds)
    : [];
  const productById = new Map(products.map((product) => [String(product._id), product]));

  return (nextCustomProducts || []).map((cpData) => {
    const payload = buildCustomProductPayload(cpData);
    const existing = currentById.get(normalizeCustomProductId(payload._id));
    delete payload._id;
    if (existing && typeof existing === "object") {
      return patchCustomProduct(existing, payload, {
        overrideFields: OVERRIDE_FIELDS,
        baseProduct: productById.get(String(existing.product)),
        blankUnsets: false,
      });
    }
    return { ...payload, _id: new mongoose.Types.ObjectId() };
  });
}

async function createRecipe(recipe) {
  return recipeDao.insert({ ...recipe, customProducts: await syncRecipeCustomProducts(recipe.customProducts || []) });
}

// Cambiar los ingredientes descarta, en todos los platos que la usan, las
// modificaciones contra ingredientes que ya no existen.
async function updateRecipe(id, recipe) {
  const current = await recipeDao.findCustomProducts(id);
  if (!current) throw notFound("Recipe not found");
  const set = { ...recipe };
  if (recipe.customProducts !== undefined) {
    set.customProducts = await syncRecipeCustomProducts(recipe.customProducts, current.customProducts || []);
    await recipeDao.rebaseCustomRecipesForRecipe(id, set.customProducts.map((item) => item._id));
  }
  return recipeDao.update(id, set);
}

// La comida destino de compose: tiene que ser del usuario, al editar la
// receta-instancia tiene que estar en ella, y nada de eso puede estar
// pautado por su profesional (mismo criterio que meal-controller). Antes se
// enganchaba una receta a la comida de cualquiera, o se editaba la
// CustomRecipe de otro. Lanza MEAL_NOT_FOUND / MEAL_PROTECTED.
async function assertComposeMealContext(userId, context, isEditMode) {
  const meal = await resolveOwnedMealById(userId, context.mealId);
  mealService.assertMealEditable(meal);
  if (!isEditMode || !context.customRecipeId) return;
  const target = (meal.customRecipes || []).find(
    (cr) => String(cr?._id || cr) === String(context.customRecipeId),
  );
  if (!target) throw badRequest("La receta indicada no está en esa comida", "MEAL_NOT_FOUND");
  mealService.assertMealEditable(target);
}

async function composeRecipe(payload, userId, isAdmin = false) {
  const { recipe, recipeId, customRecipe, context, mode } = payload || {};

  let recipeDoc = null;
  let isEditMode = mode === "edit";

  // Antes de crear o editar la receta: si la comida no vale, no se toca
  // nada (si no, quedaba una receta suelta contando para el límite Free).
  if (context?.mealId) {
    await assertComposeMealContext(userId, context, isEditMode);
  }

  if (recipeId) {
    recipeDoc = await recipeDao.getRecipeById(recipeId);
    if (!recipeDoc) throw notFound("Recipe not found");

    if (
      isEditMode &&
      recipe &&
      recipe.name &&
      (isAdmin || recipeDoc.userId?.toString() === userId)
    ) {
      const updateData = {
        name: recipe.name,
        description: recipe.description,
        customProducts: recipe.customProducts || [],
      };
      recipeDoc = await updateRecipe(recipeId, updateData);
    } else if (isEditMode && recipe) {
      throw forbidden("Cannot edit recipes you don't own");
    }
  } else if (recipe) {
    const isDefault = isAdmin && recipe.verified === true;
    recipeDoc = await createRecipe({
      name: recipe.name,
      description: recipe.description,
      customProducts: recipe.customProducts || [],
      userId: isDefault ? undefined : userId,
      verified: isDefault ? true : false,
    });
  }

  if (!recipeDoc) throw badRequest("Recipe not found or not provided");

  const hasMealContext = !!context?.mealId;
  // Sin comida todavía: el día de `currentDate` del usuario autenticado.
  const hasNewDietDayContext =
    context?.indexMeal !== undefined && !!context?.currentDate;

  if (!hasMealContext && !hasNewDietDayContext) {
    return { recipe: recipeDoc };
  }

  let customRecipeDoc = null;
  const nextCustomRecipe = {
    recipe: recipeDoc._id,
    quantity: recipeMerge.normalizePositiveNumber(
      customRecipe?.quantity,
    ),
    quantityCooked: recipeMerge.normalizePositiveNumber(
      customRecipe?.quantityCooked,
    ),
    addedCustomProducts: customRecipe?.addedCustomProducts || [],
    modifiedBaseCustomProducts:
      customRecipe?.modifiedBaseCustomProducts || [],
    removedBaseCustomProductIds:
      customRecipe?.removedBaseCustomProductIds || [],
  };

  recipeMerge.validateCustomRecipe(nextCustomRecipe);

  if (hasMealContext) {
    let updatedMeal = null;

    if (isEditMode && context?.customRecipeId) {
      customRecipeDoc = await customRecipeDao.update(
        context.customRecipeId,
        nextCustomRecipe,
      );
    } else {
      customRecipeDoc = await customRecipeDao.createCustomRecipe(
        nextCustomRecipe,
      );
    }

    if (!isEditMode) {
      const built = customRecipeDoc;
      await mealStore.pushToMeal(context.mealId, "customRecipes", built);
      customRecipeDoc = await mealStore.readMealItem(built._id, "customRecipes");
    }
    updatedMeal = await mealStore.readMeal(context.mealId);

    return {
      recipe: recipeDoc,
      customRecipe: customRecipeDoc,
      meal: updatedMeal,
    };
  }

  // Crear la receta y ponerla en una fecha que todavía no tiene día, en
  // una sola llamada: el día del usuario autenticado se asegura
  // (resolveOwnedDietDay), nunca se crea a ciegas.
  const dietDay = await resolveOwnedDietDay(userId, context.currentDate);
  const updatedDietDay = await dietDayDao.addCustomRecipeToMeal(
    dietDay,
    context.indexMeal,
    nextCustomRecipe,
  );

  return {
    recipe: recipeDoc,
    dietDay: updatedDietDay,
  };
}

// Límite Free de recetas propias: regla del cliente final, no aplica al
// admin ni a la biblioteca profesional de un entrenador.
async function assertCanCreateRecipe(user) {
  const count = await recipeDao.countByUserId(user.id);
  if (!featureAccess.canCreateRecipe(user, count)) {
    throw forbidden("Límite Free alcanzado. Solo puedes crear 2 recetas propias.", "PREMIUM_LIMIT_RECIPES");
  }
}

// Solo su dueño (o un admin) cambia o borra una receta: ni las ajenas ni las
// verificadas.
async function ownedRecipe(id, userId, isAdmin, verb = "edit") {
  const recipe = await recipeDao.getRecipeById(id);
  if (!recipe) throw notFound("Recipe not found");
  if (!isAdmin && recipe.userId?.toString() !== String(userId)) {
    throw forbidden(`Cannot ${verb} recipes you don't own`);
  }
  return recipe;
}

module.exports = {
  createRecipe,
  updateRecipe,
  composeRecipe,

  countByUserId: (userId) => recipeDao.countByUserId(userId),
  getRecipeById: (id) => recipeDao.getRecipeById(id),
  searchRecipes: (page, limit, search, userId, filters) => recipeDao.searchRecipes(page, limit, search, userId, filters),
  getUserRecipes: (userId, page, limit, search) => recipeDao.getUserRecipes(userId, page, limit, search),
  getVerifiedRecipes: (page, limit, search) => recipeDao.getVerifiedRecipes(page, limit, search),

  // Una receta privada que no puede ver responde igual que una que no
  // existe: no confirma ni su existencia.
  async getReadableRecipe(id, userId, isAdmin) {
    const recipe = await recipeDao.getRecipeById(id);
    if (!recipe || !(isAdmin || (await this.canUserReadRecipe(recipe, userId)))) {
      throw notFound("Recipe not found");
    }
    return recipe;
  },

  // Alta desde el editor de recetas. Un admin puede crearla verificada (sin
  // dueño).
  async createOwnRecipe(user, { name, description, customProducts, tags, verified }, { isAdmin }) {
    if (!isAdmin) await assertCanCreateRecipe(user);
    const isDefault = isAdmin && verified === true;
    return createRecipe({
      name,
      description,
      customProducts: customProducts || [],
      tags,
      userId: isDefault ? undefined : user.id,
      verified: isDefault,
    });
  },

  // Un trainer solo usa compose para crear una receta nueva y suelta para su
  // biblioteca (RecipeBuilderModalComponent de Trainers): nunca para ponerla
  // en una comida (recipeId/context), que es terreno del cliente.
  async composeForUser(user, payload, { isAdmin, isTrainer }) {
    const trainer = isTrainer && !isAdmin;
    if (trainer && (payload?.recipeId || payload?.context)) {
      throw forbidden("Trainers can only create standalone recipes via this endpoint");
    }
    const isCreatingNewRecipe = !payload?.recipeId && !!payload?.recipe;
    if (isCreatingNewRecipe && !isAdmin && !trainer) await assertCanCreateRecipe(user);
    return composeRecipe(payload, user.id, isAdmin);
  },

  async updateOwnRecipe(id, userId, isAdmin, changes) {
    await ownedRecipe(id, userId, isAdmin);
    return updateRecipe(id, changes);
  },

  async removeRecipeCustomProduct(idRecipe, idCustomProduct, userId, isAdmin) {
    await ownedRecipe(idRecipe, userId, isAdmin);
    const updated = await recipeDao.pullCustomProduct(idRecipe, idCustomProduct);
    if (updated) await recipeDao.rebaseCustomRecipesForRecipe(idRecipe, updated.customProducts.map((item) => item._id));
    return updated;
  },

  // Una receta que alguien tiene en un plato (también un cliente al que se
  // la pautó su entrenador) no se borra: se queda huérfana. Sin uso, se
  // borra. Sale de todas las favoritas.
  async deleteOwnRecipe(id, userId, isAdmin) {
    await ownedRecipe(id, userId, isAdmin, "delete");
    await favoritesDao.removeEverywhere("recipes", [id]);
    if (await recipeDao.isRecipeInUse(id)) {
      await recipeDao.orphan([id]);
      return;
    }
    await recipeDao.deleteById(id);
  },

  // ¿Puede `userId` leer esta receta? Las verificadas (y las globales sin
  // dueño) las ve todo el mundo; las privadas, su dueño, su entrenador o su
  // cliente (relación activa en cualquier sentido: el cliente abre la receta
  // que le pautó su entrenador y el entrenador las de su cliente), y quien
  // ya la tiene en favoritas o en su diario. El admin pasa antes.
  async canUserReadRecipe(recipe, userId) {
    if (!recipe) return false;
    if (recipe.verified || !recipe.userId) return true;
    const ownerId = String(recipe.userId);
    if (ownerId === String(userId)) return true;
    const [asTrainer, asClient] = await Promise.all([
      trainerClientDao.isActivePair(ownerId, userId),
      trainerClientDao.isActivePair(userId, ownerId),
    ]);
    if (asTrainer || asClient) return true;
    if (await recipeDao.isRecipeFavoriteOf(recipe._id, userId)) return true;
    return recipeDao.isRecipeInUserDiary(recipe._id, userId);
  },
};
