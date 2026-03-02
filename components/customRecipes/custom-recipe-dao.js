const customRecipeSchema = require("./custom-recipe-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const productSchema = require("../products/product-schema");
const recipeSchema = require("../recipes/recipe-schema");
const mealSchema = require("../meals/meal-schema");
const customRecipeUtil = require("./custom-recipe-util");
const dietDaySchema = require("../dietDays/diet-days-schema");
const dietSchema = require("../diets/diet-schema");
const { default: mongoose } = require("mongoose");

module.exports = {
  async getCustomRecipeById(id) {
    return new Promise((resolve, reject) =>
      customRecipeSchema.findById(id, (err, doc) => {
        if (err) return reject(err);
        return resolve(doc);
      }),
    );
  },

  async createCustomRecipe(customRecipe, dietDay, meal, idDietInUse, idUser) {
    let newOwnProducts = [];

    // La customRecipe puede traer customProducts con ids, por tanto
    // se eliminan para poder crear copias de esos customProducts
    for (let i = 0; i < customRecipe.customProducts.length; i++) {
      if (customRecipe.customProducts[i]._id)
        delete customRecipe.customProducts[i]._id;



      // Handle unified product
      if (
        customRecipe.customProducts[i].product &&
        typeof customRecipe.customProducts[i].product === 'object' &&
        !customRecipe.customProducts[i].product._id
      ) {
        customRecipe.customProducts[i].product._id =
          new mongoose.Types.ObjectId().toString();
        newOwnProducts.push(customRecipe.customProducts[i].product);
      }
    }

    if (newOwnProducts.length > 0) {
      // Creamos productos del usuario (unificados).
      const productDocs = await productSchema.insertMany(
        newOwnProducts.map((p) => ({ ...p, userId: idUser })),
      );

      customRecipe.customProducts.forEach((cp) => {
        productDocs.forEach((pDoc) => {

          // Sync unified product
          if (cp.product && cp.product._id === pDoc._id.toString()) {
            cp.product = pDoc._id;
          }
        });
      });
    }

    // Creamos los customProducts para customRecipe
    customRecipe.customProducts = await customProductSchema.insertMany(
      customRecipe.customProducts,
    );

    // Si tenemos este atributo es que estamos creando customRecipe
    if (idUser) {
      // El userId se maneja directamente en Recipe si es creada por usuario
      // ya no necesitamos ownRecipe
    }

    customRecipe = await customRecipeSchema.create(customRecipe);
    // Trae los products autopopulated
    customRecipe = await customRecipeSchema.findById(customRecipe);

    const addToMeal = { $push: { customRecipes: customRecipe._id } };

    // Existe dietDay
    if (dietDay._id) {
      await mealSchema.findByIdAndUpdate(meal._id, addToMeal);
      return customRecipe;
    }
    // No existe dietDay
    else {
      dietDay.meals = await mealSchema.insertMany(dietDay.meals);
      dietDay = await dietDaySchema.create(dietDay);

      // TODO: AÑADIR FIND BY ID PARA AUTOPOPULATE CUSTOM_PRODUCTS
      const idNewMeal = dietDay.meals.find(
        (mealTemp) => mealTemp.name === meal.name,
      )._id;
      await mealSchema.findByIdAndUpdate(idNewMeal, addToMeal);
      const addDietDayToDiet = { $push: { dietsDay: dietDay._id } };
      await dietSchema.findByIdAndUpdate(idDietInUse, addDietDayToDiet);
      return await dietDaySchema.findById(dietDay._id);
    }
  },

  async createNewCustomRecipe(idUser, idMeal, customRecipe) {
    try {
      let recipeToCreate = { ...customRecipe };

      delete recipeToCreate.customProducts;

      let customRecipeDoc = await customRecipeSchema.create(recipeToCreate);

      customRecipe.customProducts.map(
        (customProductTemp) => delete customProductTemp?._id,
      );

      const customProductsDoc = await customProductSchema.insertMany(
        customRecipe.customProducts,
      );

      const query2 = {
        $push: {
          customProducts: {
            $each: customProductsDoc.map((cp) => cp._id),
          },
        },
      };

      customRecipeDoc = await customRecipeSchema.findByIdAndUpdate(
        customRecipeDoc._id,
        query2,
        { new: true },
      );

      const queryMeal = { $push: { customRecipes: customRecipeDoc._id } };
      await mealSchema.findByIdAndUpdate(idMeal, queryMeal);

      return customRecipeDoc;
    } catch (error) {
      throw error;
    }
  },

  async searchCustomRecipe(page, limit, search) {
    return new Promise((resolve, reject) =>
      customRecipeSchema
        .find({ name: { $regex: search, $options: "i" } })
        .skip(page * limit)
        .limit(limit)
        .exec((err, docs) => {
          if (err) return reject(err);
          return resolve(docs);
        }),
    );
  },

  async addCustomRecipeCustomProduct(idCustomRecipe, customProduct) {
    return new Promise((resolve, reject) =>
      customProductSchema.create(customProduct, (err, customProductDoc) => {
        if (err) return reject(err);

        const addCustomRecipeCustomProduct = {
          $push: { customProducts: customProductDoc._id },
        };
        customRecipeSchema.findByIdAndUpdate(
          idCustomRecipe,
          addCustomRecipeCustomProduct,
          { new: true },
          (err, doc) => {
            if (err) return reject(err);
            return resolve(doc);
          },
        );
      }),
    );
  },

  // async deleteCustomRecipeCustomProduct(idCustomRecipe, idCustomProduct) {
  //   const deleteCustomRecipeCustomProduct = {
  //     $push: { customProducts: idCustomProduct },
  //   };
  //   return new Promise((resolve, reject) =>
  //     customRecipeSchema.findByIdAndUpdate(
  //       idCustomRecipe,
  //       addCustomRecipeCustomProduct,
  //       { new: true },
  //       (err, doc) => {
  //         if (err) return reject(err);
  //         return resolve(doc);
  //       }
  //     )
  //   );
  // },

  async update(newCustomRecipe) {
    let updateQuery = {
      $set: {
        name: newCustomRecipe.name,
        description: newCustomRecipe.description,
      },
    };

    const currentCustomRecipe = await customRecipeSchema.findById(
      newCustomRecipe._id,
    );

    // comprobar si existen nuevos productos unificados o legacy ownProducts en la actualización
    let newProductsToCreate = [];
    newCustomRecipe.customProducts.forEach((cp) => {

      // Unified product inline
      if (cp.product && typeof cp.product === 'object' && !cp.product._id) {
        cp.product._id = new mongoose.Types.ObjectId().toString();
        newProductsToCreate.push(cp.product);
      }
    });

    const ownerId = newCustomRecipe.userId || newCustomRecipe.user || null;
    if (newProductsToCreate.length > 0 && ownerId) {
      const createdDocs = await productSchema.insertMany(
        newProductsToCreate.map((p) => ({ ...p, userId: ownerId })),
      );

      // Sincronizar IDs en customProducts
      newCustomRecipe.customProducts.forEach((cp) => {
        createdDocs.forEach((pDoc) => {

          if (cp.product && cp.product._id === pDoc._id.toString()) {
            cp.product = pDoc._id;
          }
        });
      });
    }

    // customProducts que se van a crear
    let customProductsToCreate = newCustomRecipe.customProducts.filter(
      (customProductTemp) => !customProductTemp._id,
    );

    customProductsToCreate = await customProductSchema.insertMany(
      customProductsToCreate,
    );

    updateQuery.$push = {
      customProducts: {
        $each: customProductsToCreate,
      },
    };

    // customProducts para actualizar
    let customProductsToUpdate = newCustomRecipe.customProducts.filter(
      (customProductTemp) => {
        const customProduct = currentCustomRecipe.customProducts.find(
          (currentCustomProductTemp) =>
            currentCustomProductTemp._id.toString() === customProductTemp?._id,
        );
        if (customProduct) {
          customProduct._id = customProduct._id.toString();
          customProductTemp._id = customProductTemp._id.toString();

          return (
            JSON.stringify(customProduct) !== JSON.stringify(customProductTemp)
          );
        }
      },
    );

    const updateOperations = customProductsToUpdate.map((customProduct) => ({
      updateOne: {
        filter: { _id: customProduct._id },
        update: { $set: customProduct },
      },
    }));

    await customProductSchema.bulkWrite(updateOperations);

    let customProductsToDelete = [];
    // customProducts para eliminar
    for (let i = 0; i < currentCustomRecipe.customProducts.length; i++) {
      let found = false;
      for (let j = 0; j < newCustomRecipe.customProducts.length; j++) {
        if (
          newCustomRecipe.customProducts[j]._id &&
          currentCustomRecipe.customProducts[i]._id.toString() ===
            newCustomRecipe.customProducts[j]._id.toString()
        ) {
          found = true;
          break;
        }
      }
      if (!found) {
        customProductsToDelete.push(currentCustomRecipe.customProducts[i]);
      }
    }

    await customProductSchema.deleteMany({
      _id: {
        $in: customProductsToDelete.map(
          (customProductTemp) => customProductTemp._id,
        ),
      },
    });

    return await customRecipeSchema.findByIdAndUpdate(
      newCustomRecipe._id,
      updateQuery,
      { new: true },
    );
  },

  async delete(id) {
    return new Promise((resolve, reject) =>
      customRecipeSchema.deleteOne({ _id: id }, (err, doc) => {
        if (err) return reject(err);
        return resolve();
      }),
    );
  },
};
