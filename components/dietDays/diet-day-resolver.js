const userSchema = require("../users/schema");
const dietDaysService = require("./diet-days-service");
const dietDaysUtil = require("./diet-days-util");
const dietDaySchema = require("./diet-days-schema");
const mealModel = require("../meals/meal-service");
const planResolver = require("../planAssignments/plan-resolver");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");

// Fase 9 — aplica un `resolved` de plan-resolver.js#resolvePlanForDate
// ({slot: {alternatives:[...]}}) sobre un DietDay YA EXISTENTE, comida a
// comida: 0 alternativas no hace nada (slot se queda como estaba), 1
// alternativa se pastea directa (mismo criterio que siempre, sin elección
// posible), 2+ generan una MealProposal para que el cliente elija — la MISMA
// pieza que ya usa `proposeMealAlternatives` (F28) cuando el entrenador
// propone a mano, así que el banner de elección ya existente en la app del
// cliente (`meal.component.html`) la recoge sin ningún cambio en el consumidor.
// Reutilizable tanto al crear el día por primera vez como al elegir/cambiar
// el tipo de día explícitamente (ver diet-days-controller.js#chooseDayType).
async function applyResolvedPlanToDietDay(dietDayDoc, date, resolved, trainerId, clientId) {
  const mealIds = dietDayDoc.meals.map((m) => (m && m._id ? m._id : m));
  // dietDaysService.createDietDay MUTA standardDietDay.meals (sustituye los
  // objetos {name,...} por sus _id ya creados) — dietDaysUtil.MEALS es la
  // fuente de verdad original (índice -> nombre de slot) que usó
  // getStandardDietDay para construirlos, así que se lee de ahí y no de un
  // array que pudiera venir ya mutado.
  let appliedAny = false;
  for (let i = 0; i < mealIds.length; i++) {
    const slotName = dietDaysUtil.MEALS[i];
    const clipboard = resolved[slotName];
    if (!clipboard) continue;
    const alternatives = clipboard.alternatives || [];
    const nonEmpty = alternatives.filter(
      (alt) => (alt.customProducts || []).length || (alt.customRecipes || []).length
    );
    if (!nonEmpty.length) continue;

    if (nonEmpty.length === 1) {
      await mealModel.pasteMeal(
        { customProducts: nonEmpty[0].customProducts, customRecipes: nonEmpty[0].customRecipes },
        { _id: mealIds[i], customProducts: [], customRecipes: [] },
        false,
        trainerId
      );
    } else {
      await mealProposalDao.deletePendingForDateAndSlot(clientId, date, slotName);
      await mealProposalDao.create(trainerId, clientId, date, slotName, nonEmpty);
    }
    appliedAny = true;
  }
  return appliedAny;
}

// TASK-006 (MASTER_BACKLOG.md) — un DietDay ya EXISTENTE pero todavía vacío
// (autocreado antes de que el entrenador asignara/cambiara el plan) nunca
// se resincronizaba: solo el bloque "acabo de crearlo" intentaba aplicar un
// PlanAssignment. Un día se considera "todavía sin tocar" si NINGUNA de sus
// 6 comidas tiene productos o recetas — así se evita pisar cualquier comida
// que el cliente o el entrenador ya hayan pautado a mano.
function isDietDayUntouched(dietDay) {
  return (dietDay.meals || []).every(
    (meal) => !(meal.customProducts || []).length && !(meal.customRecipes || []).length
  );
}

// Intenta aplicar el PlanAssignment activo (si lo hay) sobre un DietDay ya
// existente y vacío. Nunca lanza — un fallo aquí no debe romper la lectura
// del día ya creado (mismo criterio que el bloque de creación).
async function trySyncEmptyDietDayWithActivePlan(dietDayDoc, date, userId) {
  try {
    const result = await planResolver.resolvePlanForDate(userId, date);
    if (!result) return null;

    const appliedAny = await applyResolvedPlanToDietDay(
      dietDayDoc,
      date,
      result.resolved,
      result.trainerId,
      userId
    );
    return appliedAny;
  } catch (e) {
    console.error("[resolveOwnedDietDay] Error resincronizando día vacío con plan activo:", e.message);
    return null;
  }
}

// Extraído de trainer-client-data-controller.js (F12) para reutilizarlo
// también en meal-proposal-controller.js (F28) — resuelve/crea el DietDay de
// un usuario para una fecha dada, sin asumir que ya existe. Nunca confiar en
// un mealId/mealSlot suelto sin resolverlo contra el dietInUse real del
// usuario (ver el IDOR ya documentado en meal-dao.js#pasteMeal).
async function resolveOwnedDietDay(userId, date) {
  // Refactor nutrición (2026-09) — ya no hay wrapper Diet que crear ni
  // enganchar: un día pertenece a su usuario por su propio userId, así que
  // "asegurar que el usuario tiene dieta" deja de existir como paso.
  let dietDay = await dietDaysService.findByUserAndDate(userId, date);
  if (!dietDay) {
    const standardDietDay = dietDaysUtil.getStandardDietDay(date);
    const dietDayDoc = await dietDaysService.createDietDay({
      ...standardDietDay,
      userId,
    });
    dietDay = dietDayDoc;

    // Auditoría de arquitectura (nutrición) — SOLO al crear un día nuevo: si
    // el cliente tiene un PlanAssignment activo que cubre esta fecha, se
    // rellena desde ahí en vez de quedar con las 6 comidas vacías de
    // siempre. Sin asignación activa (la inmensa mayoría de usuarios —
    // consumidores sin entrenador, o cualquier fecha fuera de cualquier
    // plan) resolvePlanForDate devuelve null y este bloque no hace nada:
    // comportamiento IDÉNTICO al de antes de esta pieza. Un fallo aquí
    // nunca debe tirar abajo la creación del día ya hecha. En modo "choice"
    // sin elección todavía (ver plan-resolver.js) esto también devuelve
    // null — el día se crea vacío hasta que el cliente elija explícitamente.
    const appliedAny = await trySyncEmptyDietDayWithActivePlan(dietDayDoc, date, userId);
    if (appliedAny) {
      dietDay = await dietDaysService.findByUserAndDate(userId, date);
    }
  } else if (isDietDayUntouched(dietDay)) {
    // TASK-006 — el día ya existía (se creó vacío en una visita anterior,
    // antes de que hubiera plan asignado) pero sigue sin ninguna comida
    // pautada: se reintenta la resolución en cada lectura hasta que algo lo
    // rellene, en vez de quedar vacío para siempre pese a que el entrenador
    // ya asignó un plan que sí lo cubre.
    const appliedAny = await trySyncEmptyDietDayWithActivePlan(dietDay, date, userId);
    if (appliedAny) {
      dietDay = await dietDaysService.findByUserAndDate(userId, date);
    }
  }

  return dietDay;
}

// Resuelve un mealId suelto (p. ej. `mealToPaste._id` enviado por el cliente
// en `PUT /meals/paste`) contra el `dietInUse` REAL del usuario autenticado,
// devolviendo el `Meal` auténtico ya autopoblado desde BD — nunca el objeto
// que pudiera enviar el cliente en el body. Corrige el IDOR documentado en
// `meal-dao.js#pasteMeal` (ver `MVP-trainers/funcionalidades/F12-pautar-comida.md`
// §15): un `mealToPaste`/`customProducts` controlado por el cliente nunca debe
// usarse para identificar QUÉ comida mutar ni qué productos/recetas borrar.
async function resolveOwnedMealById(userId, mealId) {
  // Antes: cargar la Diet entera autopoblada (todos los días, todas las
  // comidas, todos los productos) y recorrerla en memoria. Ahora la
  // pertenencia se comprueba con una única consulta indexada: el día que
  // contiene esa comida Y es de este usuario.
  const dietDay = await dietDaySchema.findOne({ userId, meals: mealId });
  const meal = (dietDay?.meals || []).find((m) => String(m._id) === String(mealId));
  if (meal) return meal;

  const err = new Error("La comida indicada no pertenece a tu dieta");
  err.code = "MEAL_NOT_FOUND";
  throw err;
}

module.exports = { resolveOwnedDietDay, resolveOwnedMealById, applyResolvedPlanToDietDay };
