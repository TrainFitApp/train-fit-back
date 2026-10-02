const mealService = require("./meal-service");
const { resolveOwnedMealById } = require("../dietDays/diet-day-resolver");
const { canActOnSubject } = require("../trainerClients/subject-access");

// Auditoría de seguridad — respuesta uniforme para los dos rechazos posibles
// al operar sobre una comida: no pertenece al usuario autenticado (IDOR, ver
// resolveOwnedMealById) o pertenece pero está protegida por un profesional
// (TAREA 1, assertMealEditable).
function handleMealError(res, e) {
  if (e.code === "MEAL_NOT_FOUND") {
    return res.status(400).send({ message: e.message, code: e.code });
  }
  if (e.code === "MEAL_PROTECTED") {
    return res.status(403).send({ message: e.message, code: e.code });
  }
  return null;
}

module.exports = {
  async getMeals(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const meals = await mealService.findAll(page, limit);
    return res.send(meals);
  },

  // Auditoría de seguridad — antes aceptaba cualquier :id sin comprobar que
  // perteneciera al usuario autenticado (IDOR de lectura). Ahora se resuelve
  // contra el dietInUse real del usuario, igual que el resto del módulo.
  async getMeal(req, res) {
    try {
      const meal = await resolveOwnedMealById(req.auth.userId, req.params.id);
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async createMeal(req, res) {
    const meal = await mealService.createMeal(req.body);

    return res.send(meal);
  },

  async searchAllWithFilters(req, res) {
    const toBoolean = (value) => {
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value.toLowerCase() === "true";
      return !!value;
    };

    // Ids de 24 hex y como mucho 50: son los recientes que el frontend ya
    // tiene cargados para esa comida y sirven solo para subirlos en el
    // ranking (ver meal-dao.js#searchAllWithFilters).
    const recentIds = (Array.isArray(req.body.recentIds) ? req.body.recentIds : [])
      .map((value) => String(value || ""))
      .filter((value) => /^[0-9a-fA-F]{24}$/.test(value))
      .slice(0, 50);

    const page = parseInt((req.body.page || 0).toString(), 10);
    const limit = 7;
    // `body.userId` es de quién son los productos propios, favoritos y
    // recientes que entran en la búsqueda: el propio usuario, o el cliente
    // al que su profesional de nutrición le está pautando. Cualquier otro id
    // se sustituye por el del token (antes se listaban los productos
    // privados y favoritos de cualquiera).
    const subjectId = req.body.userId && !(await canActOnSubject(req, req.body.userId, { trainerScope: "nutrition" }))
      ? req.user.id
      : req.body.userId;
    const list = await mealService.searchAllWithFilters(
      page,
      limit,
      req.body.search,
      toBoolean(req.body.ownFilter),
      toBoolean(req.body.recipeFilter),
      toBoolean(req.body.shieldFilter),
      toBoolean(req.body.favFilter),
      subjectId,
      recentIds,
      // Quién pregunta, además de a quién pertenece la dieta: cuando un
      // entrenador pauta una comida, `body.userId` es el del CLIENTE, y sin
      // esto los productos que el propio entrenador había creado no salían en
      // la búsqueda (ver meal-dao.js#searchAllWithFilters).
      req?.user?.id,
    );
    return res.send(list);
  },

  async addMealProduct(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idMeal);
      mealService.assertMealEditable(existing);
      const meal = await mealService.addMealProduct(
        existing._id,
        req.params.idProduct,
      );
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  // async addMealCustomRecipe(req, res) {
  //   const meal = await mealService.addMealCustomRecipe(req.body.mealId, req.body.recipeId);

  //   return res.send(meal);
  // },

  async updateMeal(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.body._id);
      mealService.assertMealEditable(existing);

      const meal = await mealService.updateMeal({
        id: existing._id,
        name: req.body.name,
        products: req.body.customProducts,
        notes: req.body.notes,
      });

      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  // Corrige un IDOR real: `mealToPaste` (y sus `customProducts`/`customRecipes`)
  // venía tal cual del body del cliente y se usaba directamente para
  // sobrescribir/borrar documentos por `_id`, sin comprobar que pertenecieran
  // al usuario autenticado (ver MVP-trainers/funcionalidades/F12-pautar-comida.md
  // §15). Ahora se resuelve el `_id` recibido contra el `dietInUse` real del
  // usuario y se usa el `Meal` auténtico de BD — nunca el objeto del cliente —
  // como destino real de la operación.
  async pasteMeal(req, res) {
    try {
      const mealToPasteId = req.body?.meals?.mealToPaste?._id;
      if (!mealToPasteId) {
        return res.status(400).send({ message: "meals.mealToPaste._id es obligatorio" });
      }

      const ownedMealToPaste = await resolveOwnedMealById(req.auth.userId, mealToPasteId);
      mealService.assertMealPasteAllowed(ownedMealToPaste, req.body.merge);

      const meal = await mealService.pasteMeal(
        req.body.meals.mealClipboard,
        ownedMealToPaste,
        req.body.merge,
      );

      return res.send(meal);
    } catch (e) {
      if (e.code === "MEAL_NOT_FOUND") {
        return res.status(400).send({ message: e.message });
      }
      const handled = handleMealError(res, e);
      if (handled) return handled;
      console.error("Error en pasteMeal:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // Solo nombre y notas, y solo de una comida del usuario. Antes hacía $set
  // del cuerpo entero sobre cualquier _id: cualquiera editaba comidas ajenas
  // y el cliente podía quitarle assignedByTrainerId a una comida pautada. Las
  // apps mandan el Meal completo (meal.component, notes.component,
  // diets.page) pero por aquí solo cambian el nombre o la nota.
  async modifyMeal(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.body?._id);
      const patch = {};
      const has = (key) => Object.prototype.hasOwnProperty.call(req.body, key);
      if (has("name") && req.body.name !== existing.name) {
        mealService.assertMealEditable(existing);
        patch.name = req.body.name;
      }
      if (has("notes")) patch.notes = req.body.notes;

      const meal = await mealService.modifyMeal(existing._id, patch);
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  // Auditoría de seguridad — corrige dos bugs a la vez: `req.param.id` (sin
  // "s", typo preexistente que hacía que este endpoint fallara siempre) y la
  // falta de verificación de propiedad (borraba cualquier :id sin comprobar
  // que perteneciera al usuario autenticado).
  async deleteMeal(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.id);
      mealService.assertMealEditable(existing);
      await mealService.deleteMeal(existing._id);
      return res.sendStatus(204);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async deleteMealProduct(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idmeal);
      mealService.assertMealEditable(existing);
      // Nivel de item, además del nivel de comida de arriba — una comida
      // "mixta" (sin assignedByTrainerId propio, ver meal-dao.js#pasteMeal)
      // puede seguir teniendo ESTE producto concreto pautado.
      const target = (existing.customProducts || []).find(
        (cp) => String(cp._id) === String(req.params.idproduct)
      );
      mealService.assertMealEditable(target);
      const meal = await mealService.deleteMealProduct(
        existing._id,
        req.params.idproduct,
      );
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async deleteMealCustomRecipe(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idmeal);
      mealService.assertMealEditable(existing);
      const target = (existing.customRecipes || []).find(
        (cr) => String(cr._id) === String(req.params.idCustomRecipe)
      );
      mealService.assertMealEditable(target);
      const meal = await mealService.deleteMealCustomRecipe(
        existing._id,
        req.params.idCustomRecipe,
      );
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async deleteMealCustomProducts(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.id);
      mealService.assertMealEditable(existing);
      const meal = await mealService.deleteMealCustomProducts(existing._id);
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async deleteMealCustomRecipes(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.id);
      mealService.assertMealEditable(existing);
      const meal = await mealService.deleteMealCustomRecipes(existing._id);
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async addMealCustomRecipe(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idMeal);
      mealService.assertMealEditable(existing);
      const meal = await mealService.addMealCustomRecipe(
        existing._id,
        req.params.idCustomRecipe,
      );
      return res.json(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      return res.status(500).json({ message: e.message });
    }
  },

  async deleteMealCustomRecipeRef(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idMeal);
      mealService.assertMealEditable(existing);
      const target = (existing.customRecipes || []).find(
        (cr) => String(cr._id) === String(req.params.idCustomRecipe)
      );
      mealService.assertMealEditable(target);
      const meal = await mealService.deleteMealCustomRecipe(
        existing._id,
        req.params.idCustomRecipe,
      );
      return res.json(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      return res.status(500).json({ message: e.message });
    }
  },

  async deleteMealCustomRecipesRef(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.id);
      mealService.assertMealEditable(existing);
      const meal = await mealService.deleteMealCustomRecipes(existing._id);
      return res.json(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      return res.status(500).json({ message: e.message });
    }
  },

  // TAREA 1 — marcar/desmarcar cumplimiento. Nunca protegido por
  // assertMealEditable (seguimiento y composición son conceptos distintos),
  // pero SÍ verifica propiedad (mismo IDOR que el resto del módulo).
  async setMealCompleted(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.id);
      const meal = await mealService.setCompleted(existing._id, req.body?.completed !== false);
      return res.send(meal);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  // TAREA (meals pautados) — marcar/desmarcar consumido un producto/receta
  // pautados. Igual que setMealCompleted, nunca protegido por
  // assertMealEditable (seguimiento ≠ composición); resuelve la comida vía
  // resolveOwnedMealById (mismo IDOR-guard que el resto del módulo) y
  // busca el item dentro de ella en vez de confiar en el :id suelto de la
  // URL para verificar pertenencia.
  async setCustomProductConsumed(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idMeal);
      const target = (existing.customProducts || []).find(
        (cp) => String(cp._id) === String(req.params.idProduct)
      );
      if (!target) {
        return res.status(400).send({ message: "Producto no encontrado en esta comida" });
      }
      const updated = await mealService.setCustomProductConsumed(target._id, req.body?.consumed !== false);
      return res.send(updated);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async setCustomRecipeConsumed(req, res) {
    try {
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idMeal);
      const target = (existing.customRecipes || []).find(
        (cr) => String(cr._id) === String(req.params.idCustomRecipe)
      );
      if (!target) {
        return res.status(400).send({ message: "Receta no encontrada en esta comida" });
      }
      const updated = await mealService.setCustomRecipeConsumed(target._id, req.body?.consumed !== false);
      return res.send(updated);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  // Ajustar cuánto de un producto pautado tomó realmente el cliente — mismo
  // IDOR-guard y mismo criterio que setCustomProductConsumed (nunca pasa
  // por assertMealEditable). No exige assignedByTrainerId: un producto
  // propio ya se edita libre por otra vía, esta es solo la vía rápida de
  // seguimiento.
  async setCustomProductQuantity(req, res) {
    try {
      const quantity = Number(req.body?.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        return res.status(400).send({ message: "Cantidad inválida" });
      }
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idMeal);
      const target = (existing.customProducts || []).find(
        (cp) => String(cp._id) === String(req.params.idProduct)
      );
      if (!target) {
        return res.status(400).send({ message: "Producto no encontrado en esta comida" });
      }
      const updated = await mealService.setCustomProductQuantity(target._id, quantity);
      return res.send(updated);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },

  async setCustomRecipeQuantity(req, res) {
    try {
      const quantity = Number(req.body?.quantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        return res.status(400).send({ message: "Cantidad inválida" });
      }
      const existing = await resolveOwnedMealById(req.auth.userId, req.params.idMeal);
      const target = (existing.customRecipes || []).find(
        (cr) => String(cr._id) === String(req.params.idCustomRecipe)
      );
      if (!target) {
        return res.status(400).send({ message: "Receta no encontrada en esta comida" });
      }
      const updated = await mealService.setCustomRecipeQuantity(target._id, quantity);
      return res.send(updated);
    } catch (e) {
      const handled = handleMealError(res, e);
      if (handled) return handled;
      throw e;
    }
  },
};
