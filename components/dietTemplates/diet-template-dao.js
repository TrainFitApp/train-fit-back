const DietTemplate = require("./diet-template-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");

// El controller (sanitizeAlternatives) ya valida label/estructura pero deja
// customProducts/customRecipes tal cual llegan del body (mismo formato
// "clipboard" crudo de siempre — {product, quantity}/{recipe, quantity}, sin
// _id real). Aquí es donde se materializan como documentos reales, mismo
// criterio que mealDao.pasteMeal usa para clonar en cualquier paste real —
// no reutiliza esa función porque pasteMeal exige un Meal destino ya
// existente (mealToPaste._id) y aquí no hay Meal de por medio, solo la
// plantilla.
async function materializeAlternative(alt) {
  const rawProducts = Array.isArray(alt?.customProducts) ? alt.customProducts : [];
  const rawRecipes = Array.isArray(alt?.customRecipes) ? alt.customRecipes : [];

  const productsToCreate = rawProducts.map((cp) => {
    const { _id, ...rest } = cp && typeof cp === "object" ? cp : {};
    return rest;
  });
  const newProducts = productsToCreate.length
    ? await customProductSchema.insertMany(productsToCreate)
    : [];

  const newRecipes = [];
  for (const cr of rawRecipes) {
    if (!cr?.recipe) continue;
    newRecipes.push(await customRecipeDao.createCustomRecipe(cr));
  }

  return {
    label: alt?.label || "",
    customProducts: newProducts.map((p) => p._id),
    customRecipes: newRecipes.map((r) => r._id),
  };
}

async function materializeMeals(meals) {
  const result = [];
  for (const meal of meals || []) {
    const alternatives = [];
    for (const alt of meal.alternatives || []) {
      alternatives.push(await materializeAlternative(alt));
    }
    result.push({ slot: meal.slot, alternatives });
  }
  return result;
}

async function materializeDays(days) {
  const result = [];
  for (const day of days || []) {
    result.push({ dayLabel: day.dayLabel, meals: await materializeMeals(day.meals) });
  }
  return result;
}

async function materializeDayPatterns(dayPatterns) {
  const result = [];
  for (const pattern of dayPatterns || []) {
    result.push({
      name: pattern.name,
      appliesTo: pattern.appliesTo,
      meals: await materializeMeals(pattern.meals),
    });
  }
  return result;
}

async function deleteContentIds({ productIds, recipeIds }) {
  if (productIds.length) await customProductSchema.deleteMany({ _id: { $in: productIds } });
  if (recipeIds.length) await customRecipeSchema.deleteMany({ _id: { $in: recipeIds } });
}

// Inverso de la population que hace autopopulate — cloneForAssignment parte
// de una plantilla ya autopoblada (days/dayPatterns con customProducts/
// customRecipes como documentos reales, no ObjectIds) y materializeDays/
// materializeDayPatterns esperan justo lo contrario: el shape "clipboard" en
// crudo que manda el frontend (product/recipe como id suelto, sin _id
// propio). Sin este paso, customRecipeDao.createCustomRecipe reutiliza el
// _id ya poblado del original en vez de crear uno nuevo -> choca con el
// documento que sigue vivo en la plantilla origen.
function flattenCustomProductRef(cp) {
  if (!cp) return cp;
  const { _id, product, baseCustomProductId, ...rest } = cp;
  return {
    ...rest,
    product: product?._id || product,
    baseCustomProductId: baseCustomProductId?._id || baseCustomProductId || null,
  };
}

function flattenCustomRecipeRef(cr) {
  if (!cr) return cr;
  const { _id, recipe, addedCustomProducts, modifiedBaseCustomProducts, ...rest } = cr;
  return {
    ...rest,
    recipe: recipe?._id || recipe,
    addedCustomProducts: (addedCustomProducts || []).map(flattenCustomProductRef),
    modifiedBaseCustomProducts: (modifiedBaseCustomProducts || []).map(flattenCustomProductRef),
  };
}

function flattenAlternativeRef(alt) {
  return {
    label: alt.label || "",
    customProducts: (alt.customProducts || []).map(flattenCustomProductRef),
    customRecipes: (alt.customRecipes || []).map(flattenCustomRecipeRef),
  };
}

function flattenMealsRef(meals) {
  return (meals || []).map((meal) => ({
    slot: meal.slot,
    alternatives: (meal.alternatives || []).map(flattenAlternativeRef),
  }));
}

function flattenDaysRef(days) {
  return (days || []).map((day) => ({ dayLabel: day.dayLabel, meals: flattenMealsRef(day.meals) }));
}

function flattenDayPatternsRef(dayPatterns) {
  return (dayPatterns || []).map((pattern) => ({
    name: pattern.name,
    appliesTo: pattern.appliesTo,
    meals: flattenMealsRef(pattern.meals),
  }));
}

module.exports = {
  // Exportadas para reuso en scripts/migrate-diet-template-refs.js (mismo
  // criterio que materializeBlocksAsExercises en workoutTemplates).
  materializeDays,
  materializeDayPatterns,

  // Congela una copia de `template` para una asignación concreta — mismo
  // criterio que workoutTemplateDao#applyToSplit, pero reusando
  // materializeDays/materializeDayPatterns en vez de un segundo camino de
  // clonado: la copia nunca comparte CustomProduct/CustomRecipe ni con la
  // plantilla original ni con otras copias, así que editar o borrar la
  // plantilla después nunca afecta a un cliente ya asignado.
  // `template` debe venir autopoblado (p. ej. findOwnedByTrainer) — .toObject()
  // y no .lean() en su fetch, porque el plugin autopopulate no actúa sobre
  // lean() y days/dayPatterns llegarían con ObjectIds crudos en vez de los
  // CustomProduct/CustomRecipe reales que materializeDays necesita para
  // volver a clonarlos.
  // `schedule` ({startDate, endMode, endDate, status}) se escribe en la
  // MISMA creación — la copia ya nace siendo la asignación, no hace falta
  // un segundo documento ni una segunda escritura.
  async cloneForAssignment(template, clientId, schedule = {}) {
    const source = template.toObject();
    return DietTemplate.create({
      trainerId: source.trainerId,
      clientId,
      sourceTemplateId: source._id,
      startDate: schedule.startDate ?? null,
      endMode: schedule.endMode ?? null,
      endDate: schedule.endDate ?? null,
      status: schedule.status ?? null,
      name: source.name,
      mode: source.mode,
      days: await materializeDays(flattenDaysRef(source.days)),
      dayPatterns: await materializeDayPatterns(flattenDayPatternsRef(source.dayPatterns)),
    });
  },

  // "Crear dieta" — el trainer construye el contenido directo para ESTE
  // cliente, sin pasar por una plantilla de la biblioteca. `days`/`dayPatterns`
  // llegan en crudo (mismo shape "clipboard" que create()), así que reusa
  // materializeDays/materializeDayPatterns directo — a diferencia de
  // cloneForAssignment no hace falta flatten porque no hay nada ya poblado
  // que desarmar. sourceTemplateId se queda en null: no hay plantilla de
  // origen, y eso ya es un estado válido (ver diet-template-schema.js).
  async createDirectAssignment(trainerId, clientId, name, days, mode, dayPatterns, schedule = {}) {
    return DietTemplate.create({
      trainerId,
      clientId,
      name,
      mode: mode || "sequential",
      days: await materializeDays(days),
      dayPatterns: await materializeDayPatterns(dayPatterns),
      startDate: schedule.startDate ?? null,
      endMode: schedule.endMode ?? null,
      endDate: schedule.endDate ?? null,
      status: schedule.status ?? null,
    });
  },

  // ownerClientId opcional — puesto, la plantilla es material de biblioteca
  // exclusivo de ese cliente (ver diet-template-schema.js); null, es general
  // y sirve para cualquiera.
  async create(trainerId, name, days, mode, dayPatterns, ownerClientId = null) {
    const created = await DietTemplate.create({
      trainerId,
      name,
      ownerClientId: ownerClientId || null,
      days: await materializeDays(days),
      mode: mode || "sequential",
      dayPatterns: await materializeDayPatterns(dayPatterns),
    });
    // create() no pasa por el middleware de autopopulate (solo corre en
    // find/findOne) — se relee para devolver customProducts/customRecipes ya
    // poblados, mismo shape que listByTrainer/update.
    return DietTemplate.findOne({ _id: created._id, trainerId });
  },

  // clientId: null excluye las copias congeladas de asignaciones (ver
  // cloneForAssignment) — esta lista es la librería de plantillas
  // reutilizables del entrenador, nunca debe mostrar una copia ya asignada.
  //
  // Por defecto SOLO generales (ownerClientId: null) — es lo que esperan
  // todos los consumidores genéricos (protocolos, plantillas, el propio
  // builder al recargar): material aplicable a cualquiera, sin colar dietas
  // que pertenecen a un cliente concreto.
  //
  // forClientId acota a un cliente y tiene las dos formas del selector de
  // "Siguiente fase":
  //   onlyOwned=true  -> SOLO las propias de ese cliente (filtro activo)
  //   onlyOwned=false -> generales + las propias de ese cliente (filtro
  //                      quitado). Nunca las propias de OTRO cliente.
  //
  // includeOwned lo usa la biblioteca ("Gestionar plantillas") para verlas
  // TODAS, generales y propias de cualquier cliente — si no, una dieta
  // propia quedaría sin sitio donde volver a editarla.
  async listByTrainer(trainerId, { forClientId = null, onlyOwned = false, includeOwned = false } = {}) {
    const filter = { trainerId, clientId: null };

    if (forClientId) {
      filter.ownerClientId = onlyOwned ? forClientId : { $in: [forClientId, null] };
    } else if (!includeOwned) {
      filter.ownerClientId = null;
    }

    return DietTemplate.find(filter).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return DietTemplate.findOne({ _id: id, trainerId });
  },

  async update(trainerId, id, { name, days, mode, dayPatterns }) {
    const existing = await DietTemplate.findOne({ _id: id, trainerId });
    if (!existing) return null;

    const setOps = {};
    if (name !== undefined) setOps.name = name;
    if (mode !== undefined) setOps.mode = mode;

    const replacingDays = days !== undefined;
    const replacingPatterns = dayPatterns !== undefined;
    if (replacingDays || replacingPatterns) {
      // Fuera el CustomProduct/CustomRecipe viejo del contenido que se
      // reemplaza, dentro el nuevo materializado — mismo criterio que
      // workoutTemplates/workout-template-dao.js#update. Solo se limpia lo
      // que de verdad se reemplaza (days o dayPatterns, no ambos si el body
      // solo tocó uno).
      const ids = DietTemplate.collectContentIds({
        days: replacingDays ? existing.days : [],
        dayPatterns: replacingPatterns ? existing.dayPatterns : [],
      });
      await deleteContentIds(ids);
    }
    if (replacingDays) setOps.days = await materializeDays(days);
    if (replacingPatterns) setOps.dayPatterns = await materializeDayPatterns(dayPatterns);

    await DietTemplate.updateOne({ _id: id }, { $set: setOps });
    return DietTemplate.findOne({ _id: id, trainerId });
  },

  // deleteOne (no deleteMany) dispara el hook en cascada de
  // diet-template-schema.js que borra los CustomProduct/CustomRecipe de la
  // plantilla (y, si es una copia, sus DietException).
  async delete(trainerId, id) {
    return DietTemplate.deleteOne({ _id: id, trainerId });
  },

  // A partir de aquí: consultas sobre copias (clientId puesto) — la copia ES
  // la asignación, así que estas son las mismas consultas que antes vivían
  // en plan-assignment-dao.js, movidas aquí al fusionar esa colección en
  // esta (ver plan-assignment-service.js). clientId siempre viene puesto por
  // el llamador, así que ninguna de estas puede devolver una plantilla real
  // por accidente (esas tienen clientId: null, nunca igual a un id concreto).

  // status no se filtra aquí por diseño: una copia "superseded" sigue siendo
  // la respuesta correcta para fechas anteriores a cuando fue sustituida.
  async findCoveringDate(clientId, date) {
    return DietTemplate.findOne({
      clientId,
      startDate: { $lte: date },
      $or: [{ endDate: null }, { endDate: { $gte: date } }],
    }).sort({ startDate: -1 });
  },

  /**
   * Copias cuyo rango se cruza con [startDate, endDate].
   *
   * `endDate: null` significa "indefinido", o sea que llega hasta el
   * infinito: hay que tratarlo como tal en los dos lados de la comparación,
   * porque una fase abierta solapa con todo lo que venga después.
   *
   * Dos rangos se cruzan si cada uno empieza antes de que el otro acabe.
   */
  async findOverlapping(clientId, startDate, endDate, { excludeId } = {}) {
    const query = {
      clientId,
      status: { $ne: "ended" },
      // La existente empieza antes de que acabe la nueva.
      ...(endDate ? { startDate: { $lte: endDate } } : {}),
      // Y acaba después de que empiece la nueva (o no acaba nunca).
      $or: [{ endDate: null }, { endDate: { $gte: startDate } }],
    };
    if (excludeId) query._id = { $ne: excludeId };
    return DietTemplate.find(query).sort({ startDate: 1 });
  },

  // La copia "activa" tal cual la entiende el entrenador ahora mismo — a lo
  // sumo una por cliente, mantenida por markSuperseded.
  async findActiveForClient(clientId) {
    return DietTemplate.findOne({ clientId, status: "active" });
  },

  async listByClient(clientId) {
    return DietTemplate.find({ clientId }).sort({ startDate: -1 });
  },

  // Dashboard trainer, "Requiere tu atención" — copias activas de CUALQUIER
  // cliente de este trainer cuyo endDate cae dentro del rango dado (p.ej.
  // próximos 7 días) — a diferencia de findActiveForClient, que es de un
  // cliente concreto. clientId: {$ne: null} de más (endDate nunca se pone en
  // una plantilla real), pero deja la consulta autoexplicativa. endDate:null
  // (indefinido) queda fuera a propósito: nada que "caduque pronto" ahí.
  async listEndingSoonForTrainer(trainerId, fromDateStr, toDateStr) {
    return DietTemplate.find({
      trainerId,
      clientId: { $ne: null },
      status: "active",
      endDate: { $ne: null, $gte: fromDateStr, $lte: toDateStr },
    })
      .populate("clientId", "name lastname")
      .lean();
  },

  async markSuperseded(id, supersededBy) {
    return DietTemplate.findByIdAndUpdate(
      id,
      { $set: { status: "superseded", supersededBy } },
      { new: true }
    );
  },
};
