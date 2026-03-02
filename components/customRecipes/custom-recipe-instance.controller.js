/**
 * CustomRecipeInstance Controller
 * Gestiona CRUD para instancias de recetas en meals
 */

const express = require("express");
const router = express.Router();
const customRecipeInstanceDao = require("./custom-recipe-instance-dao");
const recipeMergeService = require("../recipes/recipe-merge.service");

/**
 * POST /customrecipes
 * Crear una nueva CustomRecipeInstance
 */
router.post("/", async (req, res) => {
  try {
    console.log("📥 CustomRecipeInstance POST body:", req.body);

    const {
      dataRecipeId,
      quantity,
      customProductsOverrides = [],
      additionalCustomProducts = [],
    } = req.body;

    console.log("📋 Extracted values:", {
      dataRecipeId,
      quantity,
      customProductsOverrides,
      additionalCustomProducts,
    });

    if (!dataRecipeId || quantity === undefined) {
      console.error("❌ Validation failed: missing dataRecipeId or quantity");
      return res
        .status(400)
        .json({ error: "dataRecipeId and quantity are required" });
    }

    console.log("✅ Calling DAO create...");
    const instance = await customRecipeInstanceDao.create({
      dataRecipeId,
      quantity,
      customProductsOverrides,
      additionalCustomProducts,
    });

    console.log("✅ Instance created:", instance._id);
    const mergedData = await customRecipeInstanceDao.getMergedData(
      instance._id,
    );

    res.status(201).json({
      ...instance.toObject(),
      merged: mergedData,
    });
  } catch (error) {
    console.error("❌ Error in CustomRecipeInstance POST:", error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /customrecipes/:id
 * Obtener una CustomRecipeInstance con datos mezclados
 */
router.get("/:id", async (req, res) => {
  try {
    const instance = await customRecipeInstanceDao.getById(req.params.id);

    if (!instance) {
      return res.status(404).json({ error: "CustomRecipeInstance not found" });
    }

    const mergedData = await customRecipeInstanceDao.getMergedData(
      instance._id,
    );

    res.json({
      ...instance.toObject(),
      merged: mergedData,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * PUT /customrecipes/:id
 * Actualizar overrides de una CustomRecipeInstance
 * IMPORTANTE: No se puede cambiar dataRecipe (es inmutable)
 */
router.put("/:id", async (req, res) => {
  try {
    const { quantity, customProductsOverrides, additionalCustomProducts } =
      req.body;

    const updateData = {};

    if (quantity !== undefined) {
      if (quantity < 0) {
        return res.status(400).json({ error: "Quantity cannot be negative" });
      }
      updateData.quantity = quantity;
    }

    if (customProductsOverrides !== undefined) {
      updateData.customProductsOverrides = customProductsOverrides;
    }

    if (additionalCustomProducts !== undefined) {
      updateData.additionalCustomProducts = additionalCustomProducts;
    }

    const instance = await customRecipeInstanceDao.update(
      req.params.id,
      updateData,
    );

    const mergedData = await customRecipeInstanceDao.getMergedData(
      instance._id,
    );

    res.json({
      ...instance.toObject(),
      merged: mergedData,
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * DELETE /customrecipes/:id
 * Eliminar una CustomRecipeInstance
 */
router.delete("/:id", async (req, res) => {
  try {
    const result = await customRecipeInstanceDao.delete(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /customrecipes/meal/:mealId
 * Obtener todas las CustomRecipeInstances de una meal
 */
router.get("/meal/:mealId", async (req, res) => {
  try {
    const instances = await customRecipeInstanceDao.getByMealId(
      req.params.mealId,
    );

    const withMergedData = await Promise.all(
      instances.map(async (instance) => {
        const merged = await customRecipeInstanceDao.getMergedData(
          instance._id,
        );
        return {
          ...instance.toObject(),
          merged,
        };
      }),
    );

    res.json(withMergedData);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
