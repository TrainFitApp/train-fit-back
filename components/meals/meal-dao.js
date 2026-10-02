const mealSchema = require("./meal-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const productSchema = require("../products/product-schema");
const recipeSchema = require("../recipes/recipe-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const userSchema = require("../users/schema");
const {
  PRODUCT_SEARCH_CONFIG,
  RECIPE_SEARCH_CONFIG,
  parseSearchQuery,
  searchByRelevance,
  listByScope,
} = require("../util/food-search");
const { default: mongoose } = require("mongoose");

function toObjectId(id) {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

module.exports = {
  async findAll(page, limit) {
    return new Promise((resolve, reject) =>
      mealSchema
        .find({})
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  // Comida que contiene ese CustomProduct (sin poblar): para comprobar el
  // dueño de un alimento del diario a partir de su id.
  async findMealIdContainingCustomProduct(customProductId) {
    const meal = await mealSchema.findOne({ customProducts: customProductId }).select("_id").lean();
    return meal?._id || null;
  },

  async findMealIdContainingCustomRecipe(customRecipeId) {
    const meal = await mealSchema.findOne({ customRecipes: customRecipeId }).select("_id").lean();
    return meal?._id || null;
  },

  async findById(id) {
    return new Promise((resolve, reject) =>
      mealSchema.findOne({ _id: id }).exec((err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  // TAREA 1 — marcar/desmarcar cumplimiento, nunca protegido por assertMealEditable.
  async setCompleted(id, completed) {
    return mealSchema.findByIdAndUpdate(id, { $set: { completed: Boolean(completed) } }, { new: true });
  },

  async markAssignedByTrainer(id, trainerId) {
    return mealSchema.findByIdAndUpdate(id, { $set: { assignedByTrainerId: trainerId } }, { new: true });
  },

  async createMeal(meal) {
    return new Promise((resolve, reject) =>
      mealSchema.create(meal, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  // Búsqueda del catálogo para search-foods (cliente y profesional). La
  // relevancia, los índices y el rescate cuando no hay resultados viven en
  // components/util/food-search.js, compartidos con /products/search y
  // /recipes/search: antes cada endpoint tenía su propia implementación y la
  // misma query devolvía cosas distintas en cada pantalla.
  //
  // Aquí solo se resuelve QUÉ puede ver el usuario según los filtros activos
  // (propios, recetas, verificados, favoritos). `recentIds` son los recientes
  // de la comida que el frontend ya tiene en memoria: se usan para subirlos en
  // el ranking, de forma que lo que el usuario come a diario sale primero
  // también cuando escribe en el buscador, sin que el orden se rompa al
  // paginar.
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
      const userDoc = await userSchema
        .findById(userObjectId)
        .select("archivedProducts archivedRecipes")
        .lean();

      favoriteIds = isRecipes
        ? userDoc?.archivedRecipes || []
        : userDoc?.archivedProducts || [];
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

  async addMealProduct(idMeal, idProduct) {
    const addProduct = {
      $push: { customProducts: idProduct },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        addProduct,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  async addMealCustomRecipe(idMeal, idCustomRecipe) {
    const addCustomRecipe = {
      $push: { customRecipes: idCustomRecipe },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        addCustomRecipe,
        { new: true },
        (err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        },
      ),
    );
  },

  // TAREA (meals pautados) — trainerId opcional: solo lo pasan los flujos
  // controlados por un profesional (prescribeMeal/applyMealToClients/
  // MealProposal aceptada/plan-resolver), nunca el "pegar" que el propio
  // cliente usa para copiar una comida a otro día (meal-controller.js#pasteMeal,
  // que sigue llamando sin este argumento). Estampa assignedByTrainerId en
  // cada CustomProduct/CustomRecipe NUEVO — a nivel de item, no de Meal
  // completa — para que el cliente pueda seguir añadiendo sus propios
  // productos/recetas a la misma comida sin que toda ella quede bloqueada
  // (ver meal-service.js#assertMealEditable, ahora reutilizada por item).
  async pasteMeal(mealClipboard, mealToPaste, merge, trainerId = null) {
    try {
      const normalizeId = (value) => value?._id || value;
      const toPlainObject = (value) =>
        value?.toObject ? value.toObject() : { ...value };
      // Quién firma la copia: pegado por el profesional, queda pautado con
      // la cantidad de ahora como referencia (CustomProduct.assignedQuantity
      // — la cantidad con la que se pauta es, en este instante, también la
      // "consumida"). Pegado por el cliente, la copia es SUYA: nunca hereda
      // del portapapeles la marca de pautado ni el "tomado" (antes salía
      // bloqueada y alteraba la meta del día y la adherencia).
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
        return stampProvenance(payload);
      };
      const buildCustomRecipeClonePayload = (customRecipeObj) => ({
        recipe: normalizeId(customRecipeObj.recipe),
        quantity: customRecipeObj.quantity ?? null,
        quantityCooked: customRecipeObj.quantityCooked ?? null,
        ...(trainerId
          ? { assignedByTrainerId: trainerId, assignedQuantity: customRecipeObj.quantity ?? null }
          : {}),
        addedCustomProducts: (
          customRecipeObj.addedCustomProducts ||
          customRecipeObj.additionalCustomProducts ||
          []
        ).map(cloneCustomProductPayload),
        modifiedBaseCustomProducts: (
          customRecipeObj.modifiedBaseCustomProducts ||
          customRecipeObj.customProductsOverrides ||
          []
        )
          .map((override) => {
            const payload = cloneCustomProductPayload(override);
            payload.baseCustomProductId = normalizeId(
              payload.baseCustomProductId || payload.customProductId,
            );
            delete payload.customProductId;
            delete payload.removed;
            return payload;
          })
          .filter((override) => override.baseCustomProductId),
        removedBaseCustomProductIds: (
          customRecipeObj.removedBaseCustomProductIds ||
          (customRecipeObj.customProductsOverrides || [])
            .filter((override) => override.removed)
            .map((override) => override.customProductId) ||
          []
        )
          .map((removedId) => normalizeId(removedId))
          .filter(Boolean),
      });

      const clipboardCustomProducts = mealClipboard.customProducts || [];
      const clipboardCustomRecipes = mealClipboard.customRecipes || [];

      const targetCustomProducts = mealToPaste.customProducts || [];
      const targetCustomRecipes = mealToPaste.customRecipes || [];

      const customProductsToCreate = clipboardCustomProducts.map(cloneCustomProductPayload);

      const newCustomProducts = customProductsToCreate.length
        ? await customProductSchema.insertMany(customProductsToCreate)
        : [];

      const newCustomRecipes = [];

      for (const customRecipeRef of clipboardCustomRecipes) {
        const customRecipeObj = toPlainObject(customRecipeRef);
        const recipeId = normalizeId(
          customRecipeObj.recipe,
        );

        if (!recipeId) {
          continue;
        }

        const newCustomRecipe = await customRecipeDao.createCustomRecipe(
          buildCustomRecipeClonePayload(customRecipeObj),
        );

        newCustomRecipes.push(newCustomRecipe);
      }

      if (!merge) {
        await customProductSchema.deleteMany({
          _id: {
            $in: targetCustomProducts
              .map((customProductTemp) => normalizeId(customProductTemp))
              .filter(Boolean),
          },
        });

        await customRecipeSchema.deleteMany({
          _id: {
            $in: targetCustomRecipes
              .map((customRecipeTemp) => normalizeId(customRecipeTemp))
              .filter(Boolean),
          },
        });
      }

      const targetCustomProductIds = merge
        ? targetCustomProducts
            .map((customProductTemp) => normalizeId(customProductTemp))
            .filter(Boolean)
        : [];

      const targetCustomRecipeIds = merge
        ? targetCustomRecipes
            .map((customRecipeTemp) => normalizeId(customRecipeTemp))
            .filter(Boolean)
        : [];

      const updatePayload = {
        customProducts: targetCustomProductIds.concat(
          newCustomProducts.map((cp) => cp._id),
        ),
        customRecipes: targetCustomRecipeIds.concat(
          newCustomRecipes.map((customRecipe) => customRecipe._id),
        ),
      };

      return await mealSchema.findByIdAndUpdate(
        mealToPaste._id,
        updatePayload,
        {
          new: true,
        },
      );
    } catch (err) {
      throw err;
    }

    // try {
    //   // Obtención de ids de meal que se va a eliminar
    //   const mealIdsCustomProducts = mealToPaste.customProducts.map(
    //     (productTemp) => productTemp._id
    //   );
    //   await customProductSchema.deleteMany({
    //     _id: { $in: mealIdsCustomProducts },
    //   });

    //   // Creación de ids de customProducts que se van a crear en la meal
    //   const customProductsToCreate = mealClipboard.customProducts.map(
    //     (productTemp) => {
    //       return { ...productTemp, _id: new mongoose.Types.ObjectId() };
    //     }
    //   );
    //   // Asígnación de ids de customProducts a la meal a la que van a ser copiados
    //   mealToPaste.customProducts = mealClipboard.customProducts;
    //   await customProductSchema.insertMany(customProductsToCreate);

    //   const mealIdsCustomRecipes = mealToPaste.customRecipes.map(
    //     (customRecipeTemp) => customRecipeTemp._id
    //   );

    //   const mealIdsCustomRecipesCustomProducts = mealToPaste.customRecipes
    //     .map((customRecipeTemp) =>
    //       customRecipeTemp.customProducts.map(
    //         (customProductTemp) => customProductTemp._id
    //       )
    //     )
    //     .flat();

    //   await customRecipeSchema.deleteMany({
    //     _id: { $in: mealIdsCustomRecipes },
    //   });

    //   await customProductSchema.deleteMany({
    //     _id: { $in: mealIdsCustomRecipesCustomProducts },
    //   });

    //   const customRecipeCustomProductsIds = [];
    //   mealClipboard.customRecipes = mealClipboard.customRecipes.map(
    //     (customRecipe) => {
    //       customRecipe.customProducts = customRecipe.customProducts.map((customProduct) => {
    //         customProduct._id = mongoose.Types.ObjectId();
    //         customRecipeCustomProductsIds.push(customProduct);
    //         return customProduct;
    //       });
    //       customRecipe._id = mongoose.Types.ObjectId();
    //       return customRecipe;
    //     }
    //   );

    //   mealToPaste.customRecipes = mealClipboard.customRecipes;
    //   await customProductSchema.insertMany(customRecipeCustomProductsIds);
    //   await customRecipeSchema.insertMany(mealClipboard.customRecipes);

    //   const updatedMeal = await mealSchema.findByIdAndUpdate(
    //     mealToPaste._id,
    //     mealToPaste,
    //     { new: true }
    //   );

    //   return updatedMeal;
    // } catch (err) {
    //   throw err;
    // }
  },

  async updateMeal({ id, name, products, notes }) {
    const update = { $set: { name, products } };

    if (!notes || notes.trim() === "") update.$unset = { notes: 1 };
    else update.$set.notes = notes;

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(id, update, { new: true }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  // `patch` ya viene filtrado por el controller (nombre y notas). Una nota
  // vacía se quita en vez de guardarse en blanco.
  async modifyMeal(id, { name, notes } = {}) {
    const update = {};
    if (name !== undefined) update.$set = { name };
    if (notes !== undefined) {
      const text = (notes ?? "").toString().trim();
      if (text) update.$set = { ...(update.$set || {}), notes: text };
      else update.$unset = { notes: 1 };
    }
    if (!update.$set && !update.$unset) return mealSchema.findById(id);
    return mealSchema.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  },

  async deleteMeal(id) {
    return new Promise((resolve, reject) =>
      mealSchema.deleteOne({ _id: id }, (err, docs) => {
        if (err) return reject(err);
        return resolve(docs);
      }),
    );
  },

  async deleteMealProduct(idMeal, idProduct) {
    const deleteProduct = {
      $pull: { customProducts: idProduct },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        deleteProduct,
        { new: true },
        (err, mealDoc) => {
          if (err) return reject(err);

          customProductSchema.deleteOne({ _id: idProduct }, (err2, doc2) => {
            if (err2) return reject(err2);

            return resolve(mealDoc);
          });
        },
      ),
    );
  },

  async deleteMealCustomRecipe(idMeal, idCustomRecipe) {
    const deleteCustomRecipe = {
      $pull: { customRecipes: idCustomRecipe },
    };

    return new Promise((resolve, reject) =>
      mealSchema.findByIdAndUpdate(
        idMeal,
        deleteCustomRecipe,
        { new: true },
        (err, mealDoc) => {
          if (err) return reject(err);

          customRecipeSchema.deleteOne(
            { _id: idCustomRecipe },
            (err2, doc2) => {
              if (err2) return reject(err2);

              return resolve(mealDoc);
            },
          );
        },
      ),
    );
  },

  // "Salir del menú": fuera lo
  // PAUTADO (assignedByTrainerId) y sus marcas; lo que el cliente añadió por
  // su cuenta se queda. Es el espejo de deleteMealCustomProducts.
  async removePlannedItems(id) {
    const doc = await mealSchema.findById(id);
    if (!doc) return null;
    const plannedProducts = [];
    const keptProducts = [];
    for (const item of doc.customProducts || []) {
      const itemId = item._id || item;
      if (item?.assignedByTrainerId) plannedProducts.push(itemId);
      else keptProducts.push(itemId);
    }
    const plannedRecipes = [];
    const keptRecipes = [];
    for (const item of doc.customRecipes || []) {
      const itemId = item._id || item;
      if (item?.assignedByTrainerId) plannedRecipes.push(itemId);
      else keptRecipes.push(itemId);
    }
    if (plannedProducts.length) await customProductSchema.deleteMany({ _id: { $in: plannedProducts } });
    if (plannedRecipes.length) await customRecipeSchema.deleteMany({ _id: { $in: plannedRecipes } });
    return mealSchema.findByIdAndUpdate(
      id,
      {
        $set: {
          customProducts: keptProducts,
          customRecipes: keptRecipes,
          completed: false,
          assignedByTrainerId: null,
        },
      },
      { new: true }
    );
  },

  // Pautados sobreviven — antes borraba TODOS los customProducts de la
  // comida sin distinción; con items pautados individuales (ver
  // pasteMeal/assignedByTrainerId de arriba), un "vaciar comida" del
  // cliente ya no puede llevarse por delante lo que pautó su profesional
  // (mismo criterio que meal-service.js#assertMealEditable, a nivel de item).
  async deleteMealCustomProducts(id) {
    return new Promise((resolve, reject) =>
      mealSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        const deletableIds = [];
        const keptIds = [];
        for (const productTemp of doc.customProducts) {
          const productId = productTemp._id || productTemp;
          if (productTemp?.assignedByTrainerId) keptIds.push(productId);
          else deletableIds.push(productId);
        }
        customProductSchema.deleteMany(
          { _id: { $in: deletableIds } },
          (err2, doc2) => {
            if (err2) return reject(err2);
            mealSchema.findByIdAndUpdate(
              id,
              { $set: { customProducts: keptIds } },
              { new: true },
              (err3, finalDoc) => {
                if (err3) return reject(err3);
                return resolve(finalDoc);
              },
            );
          },
        );
      }),
    );
  },

  async deleteMealCustomRecipes(id) {
    return new Promise((resolve, reject) =>
      mealSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        const customRecipeIds = doc.customRecipes.map(
          (recipeTemp) => recipeTemp._id || recipeTemp,
        );
        customRecipeSchema.deleteMany(
          { _id: { $in: customRecipeIds } },
          (err2, doc2) => {
            if (err2) return reject(err2);
            mealSchema.findByIdAndUpdate(
              id,
              { $set: { customRecipes: [] } },
              { new: true },
              (err3, finalDoc) => {
                if (err3) return reject(err3);
                return resolve(finalDoc);
              },
            );
          },
        );
      }),
    );
  },
};

module.exports.addMealCustomRecipe = async function (
  idMeal,
  idCustomRecipe,
) {
  return mealSchema.findByIdAndUpdate(
    idMeal,
    { $push: { customRecipes: idCustomRecipe } },
    { new: true },
  );
};

module.exports.deleteMealCustomRecipe = async function (
  idMeal,
  idCustomRecipe,
) {
  const CustomRecipe = require("../customRecipes/custom-recipe-schema");

  // Remove from meal
  const meal = await mealSchema.findByIdAndUpdate(
    idMeal,
    { $pull: { customRecipes: idCustomRecipe } },
    { new: true },
  );

  // Delete the customRecipe document
  await CustomRecipe.findByIdAndDelete(idCustomRecipe);

  return meal;
};

// Pautadas sobreviven — mismo criterio que deleteMealCustomProducts de
// arriba (ver ese comentario).
module.exports.deleteMealCustomRecipes = async function (id) {
  const CustomRecipe = require("../customRecipes/custom-recipe-schema");

  const meal = await mealSchema.findById(id);
  const deletableIds = [];
  const keptIds = [];
  for (const recipeTemp of meal?.customRecipes || []) {
    const recipeId = recipeTemp._id || recipeTemp;
    if (recipeTemp?.assignedByTrainerId) keptIds.push(recipeId);
    else deletableIds.push(recipeId);
  }

  if (deletableIds.length > 0) {
    await CustomRecipe.deleteMany({ _id: { $in: deletableIds } });
  }

  return mealSchema.findByIdAndUpdate(
    id,
    { $set: { customRecipes: keptIds } },
    { new: true },
  );
};
