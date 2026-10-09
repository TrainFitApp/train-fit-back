const favoritesDao = require("../favorites/favorites-dao");
const productSchema = require("../products/product-schema");
const recipeSchema = require("../recipes/recipe-schema");
const mealStore = require("./meal-store");
const { buildCustomRecipe } = require("../customRecipes/custom-recipe-builder");
const {
  PRODUCT_SEARCH_CONFIG,
  RECIPE_SEARCH_CONFIG,
  parseSearchQuery,
  searchByRelevance,
  listByScope,
} = require("../util/food-search");
const { default: mongoose } = require("mongoose");

// Comidas EMBEBIDAS en su día o en una comida guardada del entrenador
// (2026-10, ver meal-store.js). Las funciones siguen recibiendo ids de comida
// y devolviendo la comida poblada, como cuando eran documentos sueltos.

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

const normalizeId = (value) => value?._id || value;
const toPlainObject = (value) => (value?.toObject ? value.toObject() : { ...value });

// Copia, para pegar, de una receta del portapapeles.
function customRecipeClonePayload(customRecipeObj, cloneCustomProductPayload) {
  return {
    recipe: normalizeId(customRecipeObj.recipe),
    quantity: customRecipeObj.quantity ?? null,
    quantityCooked: customRecipeObj.quantityCooked ?? null,
    addedCustomProducts: (customRecipeObj.addedCustomProducts || []).map(cloneCustomProductPayload),
    modifiedBaseCustomProducts: (customRecipeObj.modifiedBaseCustomProducts || [])
      .map(cloneCustomProductPayload)
      .filter((override) => override.baseCustomProductId),
    removedBaseCustomProductIds: (customRecipeObj.removedBaseCustomProductIds || []).map(normalizeId).filter(Boolean),
  };
}

/**
 * Contenido nuevo (alimentos y recetas con ids nuevos) a partir de un
 * portapapeles. `trainerId`: pegado por el profesional, queda pautado con la
 * cantidad de ahora como referencia; pegado por el cliente, la copia es SUYA
 * (nunca hereda la marca de pautado ni el "tomado").
 */
async function cloneClipboardContent(clipboard, { trainerId = null } = {}) {
  const stampProvenance = (payload) => {
    if (trainerId) {
      payload.assignedByTrainerId = trainerId;
      payload.assignedQuantity = payload.quantity ?? null;
    } else {
      delete payload.assignedByTrainerId;
      delete payload.assignedQuantity;
      delete payload.consumed;
    }
    return payload;
  };
  const cloneCustomProductPayload = (value) => {
    const payload = toPlainObject(value);
    delete payload._id;
    delete payload.__v;
    if (payload.product && typeof payload.product === "object") payload.product = payload.product._id;
    if (payload.baseCustomProductId && typeof payload.baseCustomProductId === "object") {
      payload.baseCustomProductId = payload.baseCustomProductId._id;
    }
    return stampProvenance(payload);
  };

  const customProducts = (clipboard?.customProducts || []).map((value) => ({
    ...cloneCustomProductPayload(value),
    _id: mealStore.newId(),
  }));

  const customRecipes = [];
  for (const value of clipboard?.customRecipes || []) {
    const customRecipeObj = toPlainObject(value);
    if (!normalizeId(customRecipeObj.recipe)) continue;
    customRecipes.push(
      await buildCustomRecipe({
        ...customRecipeClonePayload(customRecipeObj, cloneCustomProductPayload),
        ...(trainerId ? { assignedByTrainerId: trainerId, assignedQuantity: customRecipeObj.quantity ?? null } : {}),
      }),
    );
  }
  return { customProducts, customRecipes };
}

const isPlanned = (item) => Boolean(item?.assignedByTrainerId);

/**
 * Lo que se queda en la comida destino al pegar. Combinar (`merge`) lo deja
 * todo. Reemplazar quita lo del cliente, pero lo pautado solo lo rehace su
 * profesional (`byTrainer`): cuando pega el cliente, lo pautado del destino
 * sigue donde estaba y lo pegado se suma como suyo.
 */
function keptOnPaste(items, { merge = false, byTrainer = false } = {}) {
  if (merge) return items || [];
  return byTrainer ? [] : (items || []).filter(isPlanned);
}

module.exports = {
  cloneClipboardContent,
  keptOnPaste,

  async findById(id) {
    return mealStore.readMeal(id);
  },

  async markAssignedByTrainer(id, trainerId) {
    await mealStore.mutateMeal(id, (meal) => ({ ...meal, assignedByTrainerId: trainerId }));
    return mealStore.readMeal(id);
  },

  async searchAllWithFilters(
    page,
    limit,
    search,
    ownFilter,
    recipeFilter,
    shieldFilter,
    favFilter,
    userId,
    recentIds = [],
    authUserId = null,
  ) {
    const userObjectId = toObjectId(userId);
    const authObjectId = toObjectId(authUserId);
    const { hasSearch } = parseSearchQuery(search);

    // Propios y favoritos no existen sin usuario.
    if ((ownFilter || favFilter) && !userObjectId) return [];

    const isRecipes = !!recipeFilter;
    const model = isRecipes ? recipeSchema : productSchema;
    const config = isRecipes ? RECIPE_SEARCH_CONFIG : PRODUCT_SEARCH_CONFIG;

    // Los favoritos hacen falta para filtrar por ellos y para puntuarlos en la
    // búsqueda; en un listado sin texto y sin ese filtro, no.
    let favoriteIds = [];
    if (userObjectId && (favFilter || hasSearch)) {
      favoriteIds = await favoritesDao.list(userObjectId, isRecipes ? "recipes" : "products");
    }

    if (favFilter && !favoriteIds.length) return [];

    // Los recientes que manda el frontend son productos (la pestaña de recetas
    // no los usa), así que solo cuentan en la búsqueda de productos.
    const recentObjectIds = isRecipes
      ? []
      : (Array.isArray(recentIds) ? recentIds : [])
          .map((value) => toObjectId(value))
          .filter(Boolean);

    const scope = {};

    if (favFilter) {
      // La lista de favoritos ya es un conjunto cerrado de ids que el usuario
      // eligió: no se le añade el filtro de visibilidad, que escondería un
      // producto creado por su entrenador y marcado por él como favorito.
      scope._id = { $in: favoriteIds };
      if (ownFilter) scope.userId = userObjectId;
    } else if (ownFilter) {
      // "Solo los míos" es una petición explícita: no se ensancha. Los del
      // entrenador cuando pauta, sí son "los míos" desde su punto de vista.
      scope.userId =
        authObjectId && String(authObjectId) !== String(userObjectId)
          ? { $in: [userObjectId, authObjectId] }
          : userObjectId;
    } else if (userObjectId) {
      // Igualdad a null: cubre también los documentos sin el campo, así que
      // sobra la rama `{userId: {$exists: false}}` que antes convertía esto en
      // un $or de tres ramas (tres recorridos de índice en cada etapa).
      // El dueño de la dieta y, si no son el mismo, quien está buscando: al
      // pautar una comida `userId` es el del cliente, y el entrenador también
      // tiene que encontrar los productos que ha creado él.
      const owners = [userObjectId, null];
      if (authObjectId && String(authObjectId) !== String(userObjectId)) {
        owners.splice(1, 0, authObjectId);
      }

      const visibility = { userId: { $in: owners } };

      // Lo que el usuario YA usa tiene que poder buscarse, aunque el producto
      // sea de otro dueño: un alimento que le pautó su entrenador (creado con
      // el userId del entrenador) se quedaba fuera del alcance y no aparecía
      // al escribir su nombre, por mucho que el cliente lo comiera a diario.
      // Son conjuntos cerrados de ids que ya están en sus comidas o en sus
      // favoritos, así que no abren el catálogo de nadie más.
      const alsoVisibleIds = [...recentObjectIds, ...favoriteIds];

      if (alsoVisibleIds.length) {
        scope.$or = [visibility, { _id: { $in: alsoVisibleIds } }];
      } else {
        Object.assign(scope, visibility);
      }
    } else {
      scope.userId = null;
    }

    if (shieldFilter) scope.verified = true;

    const context = {
      ownerId: userObjectId,
      favoriteIds: new Set(favoriteIds.map((value) => String(value))),
      recentIds: new Set(recentObjectIds.map((value) => String(value))),
    };

    if (!hasSearch) {
      return listByScope({ model, scope, page, limit, config });
    }

    return searchByRelevance({
      model,
      scope,
      search,
      page,
      limit,
      context,
      config,
    });
  },

  // Pega el portapapeles en la comida: con `merge` se añade a lo que ya
  // tiene; sin él, lo sustituye (ver keptOnPaste: el cliente nunca se lleva
  // lo pautado). `trainerId` solo lo pasan los flujos del profesional
  // (pautar, aplicar a clientes, propuestas, plan): estampa
  // assignedByTrainerId en cada alimento/receta NUEVO, a nivel de item, para
  // que el cliente pueda seguir añadiendo lo suyo a la misma comida.
  async pasteMeal(mealClipboard, mealToPaste, merge, trainerId = null) {
    const mealId = normalizeId(mealToPaste);
    const content = await cloneClipboardContent(mealClipboard, { trainerId });
    const keep = { merge, byTrainer: Boolean(trainerId) };
    await mealStore.mutateMeal(mealId, (meal) => ({
      ...meal,
      customProducts: [...keptOnPaste(meal.customProducts, keep), ...content.customProducts],
      customRecipes: [...keptOnPaste(meal.customRecipes, keep), ...content.customRecipes],
    }));
    return mealStore.readMeal(mealId);
  },

  // `patch` ya viene filtrado por el controller (nombre y notas). Una nota
  // vacía se quita en vez de guardarse en blanco.
  async modifyMeal(id, { name, notes } = {}) {
    if (name === undefined && notes === undefined) return mealStore.readMeal(id);
    await mealStore.mutateMeal(id, (meal) => {
      const next = { ...meal };
      if (name !== undefined) next.name = name;
      if (notes !== undefined) {
        const text = (notes ?? "").toString().trim();
        if (text) next.notes = text;
        else delete next.notes;
      }
      return next;
    });
    return mealStore.readMeal(id);
  },

  async deleteMealProduct(idMeal, idProduct) {
    await mealStore.mutateMeal(idMeal, (meal) => ({
      ...meal,
      customProducts: (meal.customProducts || []).filter((item) => String(item._id) !== String(idProduct)),
    }));
    return mealStore.readMeal(idMeal);
  },

  async deleteMealCustomRecipe(idMeal, idCustomRecipe) {
    await mealStore.mutateMeal(idMeal, (meal) => ({
      ...meal,
      customRecipes: (meal.customRecipes || []).filter((item) => String(item._id) !== String(idCustomRecipe)),
    }));
    return mealStore.readMeal(idMeal);
  },

  // "Salir del menú": fuera lo PAUTADO (assignedByTrainerId) y sus marcas;
  // lo que el cliente añadió por su cuenta se queda. Es el espejo de
  // deleteMealCustomProducts.
  async removePlannedItems(id) {
    const found = await mealStore.mutateMeal(id, (meal) => ({
      ...meal,
      customProducts: (meal.customProducts || []).filter((item) => !isPlanned(item)),
      customRecipes: (meal.customRecipes || []).filter((item) => !isPlanned(item)),
      assignedByTrainerId: null,
    }));
    return found ? mealStore.readMeal(id) : null;
  },

  // "Vaciar comida" del cliente: lo pautado por su profesional sobrevive
  // (mismo criterio que meal-service.js#assertMealEditable, a nivel de item).
  async deleteMealCustomProducts(id) {
    await mealStore.mutateMeal(id, (meal) => ({
      ...meal,
      customProducts: (meal.customProducts || []).filter(isPlanned),
    }));
    return mealStore.readMeal(id);
  },

  // Pautadas sobreviven — mismo criterio que deleteMealCustomProducts.
  async deleteMealCustomRecipes(id) {
    await mealStore.mutateMeal(id, (meal) => ({
      ...meal,
      customRecipes: (meal.customRecipes || []).filter(isPlanned),
    }));
    return mealStore.readMeal(id);
  },
};
