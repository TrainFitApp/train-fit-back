const DietTemplate = require("./diet-template-schema");
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeDao = require("../customRecipes/custom-recipe-dao");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");
const { deriveSuitability } = require("./diet-suitability");
const { scaleMealsContent } = require("../planAssignments/cycle-progression");

// Sugerencias de dieta — `suitableFor` (vegana / sin gluten / ...) es DERIVADO
// del contenido, nunca tecleado: se recalcula tras cada create/update, igual
// que basisAmount en FoodExchangeGroup. Necesita el doc ya autopoblado
// (customProducts con sus flags), por eso se hace en una segunda pasada.
async function recomputeSuitability(id) {
  const doc = await DietTemplate.findById(id);
  if (!doc) return doc;
  const { suitableFor } = deriveSuitability(doc.toObject());
  await DietTemplate.updateOne({ _id: id }, { $set: { suitableFor } });
  return DietTemplate.findById(id);
}

// Campos de FASE que se escriben en el primer ciclo (el "head"). Ausentes si
// no se está empezando una fase (aplicar un plan al estilo de siempre).
function phaseFields(phase, cycleTarget) {
  if (!phase) return {};
  return {
    phaseName: phase.name || null,
    phaseFocus: phase.focus || null,
    phaseTargetKcalDelta: Number.isFinite(phase.targetKcalDelta) ? phase.targetKcalDelta : null,
    targetRatePerCycle: Number.isFinite(phase.ratePerCycle) ? phase.ratePerCycle : null,
    cycleTargetKcal: cycleTarget?.kcal ?? null,
    cycleTargetMacros: cycleTarget?.macros ?? undefined,
  };
}

// El head de una fase se apunta a sí mismo con phaseId (patrón supersededBy).
async function finalizePhaseHead(created, phase) {
  if (!phase) return created;
  await DietTemplate.updateOne({ _id: created._id }, { $set: { phaseId: created._id } });
  return DietTemplate.findById(created._id);
}

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
    const created = await DietTemplate.create({
      trainerId: source.trainerId,
      clientId,
      sourceTemplateId: source._id,
      startDate: schedule.startDate ?? null,
      endMode: schedule.endMode ?? null,
      endDate: schedule.endDate ?? null,
      estimatedEndDate: schedule.estimatedEndDate ?? null,
      status: schedule.status ?? null,
      name: source.name,
      mode: source.mode,
      days: await materializeDays(flattenDaysRef(source.days)),
      dayPatterns: await materializeDayPatterns(flattenDayPatternsRef(source.dayPatterns)),
      suitableFor: source.suitableFor || [],
      suitableForOverride: source.suitableForOverride || [],
      ...phaseFields(schedule.phase, schedule.cycleTarget),
    });
    return finalizePhaseHead(created, schedule.phase);
  },

  // Flujo B — un ciclo nuevo dentro de una fase existente. El contenido ya
  // viene materializado/escalado por el servicio (cycle-progression.js); el
  // nombre y el focus de la fase se heredan del primer ciclo (phaseHead).
  async createCycle({ trainerId, clientId, phaseId, name, mode, days, dayPatterns, schedule = {} }) {
    const head = await DietTemplate.findById(phaseId).lean();
    const created = await DietTemplate.create({
      trainerId,
      clientId,
      phaseId,
      phaseName: undefined, // vive solo en el head
      name: name || head?.name || "Ciclo",
      mode: mode || head?.mode || "sequential",
      days: await materializeDays(days || []),
      dayPatterns: await materializeDayPatterns(dayPatterns || []),
      startDate: schedule.startDate ?? null,
      endMode: schedule.endMode ?? "indefinite",
      endDate: schedule.endDate ?? null,
      estimatedEndDate: schedule.estimatedEndDate ?? null,
      status: schedule.status ?? "active",
      cycleTargetKcal: schedule.cycleTarget?.kcal ?? null,
      cycleTargetMacros: schedule.cycleTarget?.macros ?? undefined,
    });
    return recomputeSuitability(created._id);
  },

  // Contenido de una copia (ciclo) aplanado a "clipboard" y escalado por
  // `factor` — listo para createCycle. `factor` 1 = copia idéntica.
  scaledCycleContent(prevCycle, factor = 1) {
    const src = prevCycle.toObject ? prevCycle.toObject() : prevCycle;
    return {
      mode: src.mode,
      days: flattenDaysRef(src.days || []).map((d) => ({
        ...d,
        meals: scaleMealsContent(d.meals, factor),
      })),
      dayPatterns: flattenDayPatternsRef(src.dayPatterns || []).map((p) => ({
        ...p,
        meals: scaleMealsContent(p.meals, factor),
      })),
    };
  },

  async findCyclesOfPhase(phaseId) {
    return DietTemplate.find({ phaseId }).sort({ startDate: 1, createdAt: 1 });
  },

  async findPhaseHead(phaseId) {
    return DietTemplate.findById(phaseId);
  },

  // La fase "vigente" para un cliente = la del ciclo activo (tip de la cadena).
  async findActivePhaseId(clientId) {
    const active = await DietTemplate.findOne({ clientId, status: "active" }).select("phaseId").lean();
    return active?.phaseId || null;
  },

  // "Crear dieta" — el trainer construye el contenido directo para ESTE
  // cliente, sin pasar por una plantilla de la biblioteca. `days`/`dayPatterns`
  // llegan en crudo (mismo shape "clipboard" que create()), así que reusa
  // materializeDays/materializeDayPatterns directo — a diferencia de
  // cloneForAssignment no hace falta flatten porque no hay nada ya poblado
  // que desarmar. sourceTemplateId se queda en null: no hay plantilla de
  // origen, y eso ya es un estado válido (ver diet-template-schema.js).
  async createDirectAssignment(trainerId, clientId, name, days, mode, dayPatterns, schedule = {}) {
    const created = await DietTemplate.create({
      trainerId,
      clientId,
      name,
      mode: mode || "sequential",
      days: await materializeDays(days),
      dayPatterns: await materializeDayPatterns(dayPatterns),
      startDate: schedule.startDate ?? null,
      endMode: schedule.endMode ?? null,
      endDate: schedule.endDate ?? null,
      estimatedEndDate: schedule.estimatedEndDate ?? null,
      status: schedule.status ?? null,
      ...phaseFields(schedule.phase, schedule.cycleTarget),
    });
    const head = await finalizePhaseHead(created, schedule.phase);
    return recomputeSuitability(head._id);
  },

  // ownerClientId opcional — puesto, la plantilla es material de biblioteca
  // exclusivo de ese cliente (ver diet-template-schema.js); null, es general
  // y sirve para cualquiera.
  async create(trainerId, name, days, mode, dayPatterns, ownerClientId = null, verified = false) {
    const created = await DietTemplate.create({
      trainerId,
      name,
      // Solo se escribe si hay dueño — una plantilla general no lleva la
      // clave en absoluto (ver diet-template-schema.js).
      ...(ownerClientId ? { ownerClientId } : {}),
      // Sugerencias de dieta — dieta de fábrica (solo admin, ver controller).
      ...(verified ? { verified: true } : {}),
      days: await materializeDays(days),
      mode: mode || "sequential",
      dayPatterns: await materializeDayPatterns(dayPatterns),
    });
    // create() no pasa por el middleware de autopopulate (solo corre en
    // find/findOne) — se relee para devolver customProducts/customRecipes ya
    // poblados, mismo shape que listByTrainer/update.
    return recomputeSuitability(created._id);
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

  // Sugerencias de dieta — plantillas de BIBLIOTECA que se pueden rankear
  // para este cliente: las generales del entrenador, las propias de este
  // cliente (ownerClientId), y las de fábrica (verified) de cualquiera.
  // Nunca copias congeladas (clientId: null en todas).
  // `sources` acota el origen (filtro del cajón): 'general' = plantillas
  // generales del entrenador, 'client' = las propias de este cliente,
  // 'verified' = las de fábrica. Sin `sources` (o vacío) = las tres.
  async listRankableForClient(trainerId, clientId, sources) {
    const set = new Set(sources && sources.length ? sources : ["general", "client", "verified"]);
    const or = [];
    if (set.has("general")) or.push({ trainerId, ownerClientId: null });
    if (set.has("client")) or.push({ trainerId, ownerClientId: clientId });
    if (set.has("verified")) or.push({ verified: true });
    if (!or.length) return [];
    return DietTemplate.find({ clientId: null, $or: or }).sort({ createdAt: -1 });
  },

  async update(trainerId, id, { name, days, mode, dayPatterns, suitableForOverride, verified }) {
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

    if (Array.isArray(suitableForOverride)) {
      setOps.suitableForOverride = suitableForOverride.filter((f) =>
        ["vegan", "vegetarian", "lactoseFree", "glutenFree"].includes(f)
      );
    }
    if (typeof verified === "boolean") setOps.verified = verified;

    await DietTemplate.updateOne({ _id: id }, { $set: setOps });
    return recomputeSuitability(id);
  },

  // Edición de fases/ciclos — mismo mecanismo que `update` (arriba) pero con
  // el filtro que ahí falta: exige que la copia sea de ESTE cliente
  // concreto, no solo del trainer. Nunca toca una plantilla de biblioteca
  // (`clientId: null` no puede matchear aquí) ni la copia de otro cliente.
  // Funciona igual para el ciclo 1 que para cualquier ciclo posterior
  // (creado por "Siguiente ciclo") porque opera sobre el `_id` de la propia
  // copia, sin pasar por `sourceTemplateId`.
  async updateAssignedContent(trainerId, clientId, id, { name, mode, days, dayPatterns }) {
    const existing = await DietTemplate.findOne({ _id: id, trainerId, clientId });
    if (!existing) return null;

    const setOps = {};
    if (name !== undefined) setOps.name = name;
    if (mode !== undefined) setOps.mode = mode;

    const replacingDays = days !== undefined;
    const replacingPatterns = dayPatterns !== undefined;
    if (replacingDays || replacingPatterns) {
      const ids = DietTemplate.collectContentIds({
        days: replacingDays ? existing.days : [],
        dayPatterns: replacingPatterns ? existing.dayPatterns : [],
      });
      await deleteContentIds(ids);
    }
    if (replacingDays) setOps.days = await materializeDays(days);
    if (replacingPatterns) setOps.dayPatterns = await materializeDayPatterns(dayPatterns);

    await DietTemplate.updateOne({ _id: id }, { $set: setOps });
    return recomputeSuitability(id);
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
      // Y acaba después de que empiece la nueva (o no acaba nunca). El fin
      // EFECTIVO es el real si ya se cortó; si sigue corriendo, su estimación
      // (que reserva el tramo aunque no lo cierre); y si no hay ninguna de las
      // dos, no acaba nunca.
      $or: [
        { endDate: { $gte: startDate } },
        { endDate: null, estimatedEndDate: { $gte: startDate } },
        { endDate: null, estimatedEndDate: null },
      ],
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
  // cliente de este trainer cuya ESTIMACIÓN se acaba dentro del rango dado
  // (p.ej. próximos 7 días) — a diferencia de findActiveForClient, que es de un
  // cliente concreto. clientId: {$ne: null} de más (estimatedEndDate nunca se
  // pone en una plantilla real), pero deja la consulta autoexplicativa.
  //
  // Mira estimatedEndDate y no endDate: una fase activa ya nunca tiene fin
  // real (se estampa solo al cortarla), así que con endDate esta señal se
  // habría quedado muda. Sin estimación no hay nada que avisar.
  async listEndingSoonForTrainer(trainerId, fromDateStr, toDateStr) {
    return DietTemplate.find({
      trainerId,
      clientId: { $ne: null },
      status: "active",
      estimatedEndDate: { $ne: null, $gte: fromDateStr, $lte: toDateStr },
    })
      .populate("clientId", "name lastname")
      .lean();
  },

  // `endDate` = fin REAL de la fase que se corta (el día anterior al inicio de
  // la que entra). Desde que la duración es una estimación, ninguna asignación
  // nace con fecha de fin: si no se estampara aquí, el historial entero se
  // quedaría sin fechas de fin y no habría forma de cerrar los tramos del
  // calendario ni de saber cuánto duró de verdad cada fase.
  async markSuperseded(id, supersededBy, endDate = null) {
    return DietTemplate.findByIdAndUpdate(
      id,
      { $set: { status: "superseded", supersededBy, ...(endDate ? { endDate } : {}) } },
      { new: true }
    );
  },

  // Borrado coherente de fases (nutrición) — mismo trío que
  // routineAssignmentDao para entrenamiento (findByIdAndClient/deleteById/
  // reactivate). findByIdAndClient primero: quien borra siempre comprueba
  // pertenencia antes de nada, así que deleteById no necesita repetir el
  // filtro por clientId.
  async findByIdAndClient(id, clientId) {
    return DietTemplate.findOne({ _id: id, clientId });
  },

  // findByIdAndDelete (no deleteOne) para que dispare el mismo hook en
  // cascada que dietTemplateDao.delete() — está registrado sobre
  // "findOneAndDelete", no sobre el borrado del documento en sí.
  async deleteById(id) {
    return DietTemplate.findByIdAndDelete(id);
  },

  // Al cancelar la fase "active" (el tip de la cadena) hay que reactivar la
  // que queda más reciente, o el cliente se queda sin ninguna fase "active"
  // — mismo invariante que RoutineAssignment#reactivate.
  async reactivate(id) {
    return DietTemplate.findByIdAndUpdate(
      id,
      { $set: { status: "active" }, $unset: { supersededBy: "" } },
      { new: true }
    );
  },
};
