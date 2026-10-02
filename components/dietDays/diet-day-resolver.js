const dietDaysService = require("./diet-days-service");
const dietDaysUtil = require("./diet-days-util");
const dietDaySchema = require("./diet-days-schema");
const planResolver = require("../planAssignments/plan-resolver");
const mealProposalDao = require("../mealProposals/meal-proposal-dao");
const { daysInRange, addDaysToIsoDate } = require("../util/date-util");

// Fase 9 — aplica un `resolved` de plan-resolver.js#resolvePlanForDate
// ({slot: {alternatives:[...]}}) sobre un DietDay YA EXISTENTE, comida a
// comida. Opciones de comida (2026-09): 1 alternativa se pautea directa;
// 2+ se guardan en la comida con la PRIMERA ya aplicada (el cliente alterna
// desde el selector de `meal.component.html`, sin estado "pendiente");
// 0 alternativas (plan sin nada para ese hueco, o excepción "skip") retira
// lo pautado y el selector. Lo que el cliente añadió por su cuenta nunca se
// toca (ver meal-proposal-dao.js#applyAlternative). Reutilizable tanto al
// crear el día por primera vez como al elegir/cambiar el tipo de día
// explícitamente (ver diet-days-controller.js#chooseDayType).
// `clearMissing`: un slot que el plan ya no menciona se trata como vacío
// (al resincronizar un día ya creado y al cambiar de menú — al crear el día
// se deja como estaba, que es lo de siempre).
async function applyResolvedPlanToDietDay(dietDayDoc, date, resolved, trainerId, clientId, { clearMissing = false } = {}) {
  // dietDaysUtil.MEALS es la fuente de verdad del hueco (índice -> nombre de
  // slot): el mismo mapa que usó getStandardDietDay al construir las comidas
  // del día, así que el nombre se lee de ahí y nunca de `meals[i].name`, que
  // puede llegar sin poblar.
  let appliedAny = false;
  for (let i = 0; i < dietDayDoc.meals.length; i++) {
    const slotName = dietDaysUtil.MEALS[i];
    const clipboard = resolved[slotName] || (clearMissing ? { alternatives: [] } : null);
    if (!clipboard) continue;
    const alternatives = clipboard.alternatives || [];
    const nonEmpty = alternatives.filter(
      (alt) => (alt.customProducts || []).length || (alt.customRecipes || []).length
    );
    if (!nonEmpty.length) {
      await mealProposalDao.clearForDateAndSlot(clientId, date, slotName);
      continue;
    }

    await mealProposalDao.create(trainerId, clientId, date, slotName, nonEmpty);
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
  //
  // 2026-10 — la creación vive entera en ensureDietDay (idempotente y a
  // prueba de carreras); aquí solo queda lo que es propio del resolver:
  // aplicar el plan activo.
  let { dietDay, created } = await dietDaysService.ensureDietDay(userId, date);
  if (created) {
    // Auditoría de arquitectura (nutrición) — SOLO al crear un día nuevo: si
    // el cliente tiene un PlanAssignment activo que cubre esta fecha, se
    // rellena desde ahí en vez de quedar con las 6 comidas vacías de
    // siempre. Sin asignación activa (la inmensa mayoría de usuarios —
    // consumidores sin entrenador, o cualquier fecha fuera de cualquier
    // plan) resolvePlanForDate devuelve null y este bloque no hace nada:
    // comportamiento IDÉNTICO al de antes de esta pieza. Un fallo aquí
    // nunca debe tirar abajo la creación del día ya hecha. Sin menú elegido
    // todavía (ver plan-resolver.js) esto también devuelve null — el día se
    // crea vacío hasta que el cliente elija explícitamente.
    const appliedAny = await trySyncEmptyDietDayWithActivePlan(dietDay, date, userId);
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

// Opciones de comida (2026-09) — el profesional edita una fase/semana ya
// asignado (añade una opción, cambia cantidades…) y los días que el cliente
// YA había abierto no se enteraban: solo se resolvía el plan al crear el día
// o si seguía vacío. Vuelve a aplicar el plan sobre los DietDay existentes
// del cliente en [from, to] (to null = sin tope), pasados incluidos: un día
// sin nada marcado no es histórico real, es un día que el cliente aún no ha
// seguido. Se salta:
//   · días con algún alimento pautado ya marcado como consumido (el cliente
//     ya está siguiendo ese día tal como estaba),
//   · días para los que el plan no resuelve nada (fuera de plan, o sin menú
//     elegido).
// Lo que el cliente añadió por su cuenta se conserva (applyAlternative).
// Nunca lanza: un fallo aquí no debe tumbar la edición del plan.
// Un día en el que el cliente ya marcó como tomado algo pautado: ya lo está
// siguiendo tal como estaba, así que ni se resincroniza ni se vacía.
function hasConsumedPlanned(day) {
  return (day.meals || []).some(
    (meal) =>
      (meal?.customProducts || []).some((cp) => cp?.assignedByTrainerId && cp?.consumed) ||
      (meal?.customRecipes || []).some((cr) => cr?.assignedByTrainerId && cr?.consumed)
  );
}

function findClientDaysInRange(clientId, from, to) {
  const dateFilter = { $gte: from };
  if (to) dateFilter.$lte = to;
  return dietDaySchema
    .find({ userId: clientId, date: dateFilter })
    .select("_id date meals menuName")
    .sort({ date: 1 });
}

async function resyncPlannedDays(clientId, from, to = null) {
  if (!from) return 0;

  let resynced = 0;
  try {
    const days = await findClientDaysInRange(clientId, from, to);

    for (const day of days) {
      if (hasConsumedPlanned(day)) continue;

      const result = await planResolver.resolvePlanForDate(clientId, day.date, {
        chosenMenuName: day.menuName || undefined,
      });
      if (!result) continue;

      await applyResolvedPlanToDietDay(day, day.date, result.resolved, result.trainerId, clientId, {
        clearMissing: true,
      });
      resynced += 1;
    }
  } catch (e) {
    console.error("[resyncPlannedDays] Error resincronizando días con el plan:", e.message);
  }
  return resynced;
}

// Quitar una fase: los días que el cliente ya había abierto con ella se
// vacían de lo pautado (y del menú elegido), salvo los que ya estaba
// siguiendo, y se vuelven a resolver con lo que rija ahora (la fase que se
// reactiva, si la hay). resyncPlannedDays solo no basta: cuando el plan ya
// no resuelve nada para un día, se lo salta y lo pautado se quedaba, con su
// meta. Nunca lanza, como resyncPlannedDays.
async function clearAndResyncPlannedDays(clientId, from, to = null) {
  if (!from) return 0;
  // Import diferido: diet-skips no depende de este módulo, pero así se evita
  // cualquier ciclo al cargar.
  const { clearPlannedDay } = require("./diet-skips");
  try {
    const days = await findClientDaysInRange(clientId, from, to);
    for (const day of days) {
      if (hasConsumedPlanned(day)) continue;
      await clearPlannedDay(clientId, day.date, day);
    }
  } catch (e) {
    console.error("[clearAndResyncPlannedDays] Error vaciando días de la fase quitada:", e.message);
  }
  return resyncPlannedDays(clientId, from, to);
}

// F20-undecies — getFullyPopulatedDietDaysForDiet SOLO devuelve DietDay que
// YA EXISTEN como documento; la resolución de un plan es LAZY
// (resolveOwnedDietDay materializa un día la primera vez que alguien lo
// abre — el cliente en su app, o el entrenador al mirar esa fecha desde la
// ficha). La inmensa mayoría de los días de una ventana de 30/90 días
// nunca se han "abierto" por nadie, así que adherencia/cumplimiento/
// seguimiento salían casi vacíos para un plan recién aplicado aunque SÍ lo
// cubriera — bug real, no "sin datos". Para cada fecha del rango sin
// DietDay real, resuelve el plan sobre la marcha (resolvePlanForDate, sin
// escribir nada en BD — un GET no debe materializar 90 documentos) y
// construye una comida "sintética" con lo pautado (primera alternativa de
// cada slot, mismo criterio que el total de macros del builder). Sin
// datos de consumo real —nada se ha marcado porque nadie ha abierto ese
// día—, pero eso es justo lo correcto: hasPlan=true, 0% consumido.
//
// Extraída de trainer-client-data-controller.js (F20-undecies) para
// reutilizarla también en client-data-loader.js (Resumen de la ficha,
// Auditoría 2026-09): el mismo bug de materialización que ya se arregló
// para "Seguimiento" seguía vivo en el cálculo de adherencia del Resumen,
// que leía los DietDay materializados directamente sin pasar por aquí.
async function getTrackingDaysForClient(clientId, dietId, from, to) {
  const materialized = dietId
    ? await dietDaysService.getFullyPopulatedDietDaysForUser(dietId, from, to)
    : [];
  const materializedDates = new Set(materialized.map((d) => d.date));

  const days = [...materialized];
  const totalDays = daysInRange(from, to);
  for (let i = 0; i < totalDays; i++) {
    const date = addDaysToIsoDate(from, i);
    if (materializedDates.has(date)) continue;

    let result;
    try {
      result = await planResolver.resolvePlanForDate(clientId, date);
    } catch (e) {
      continue;
    }
    if (!result) continue;

    const meals = Object.values(result.resolved || {})
      .map((slot) => slot.alternatives?.[0])
      .filter((alt) => alt && ((alt.customProducts || []).length || (alt.customRecipes || []).length))
      .map((alt) => ({
        completed: false,
        customProducts: (alt.customProducts || []).map((cp) => ({
          ...(typeof cp.toObject === "function" ? cp.toObject() : cp),
          assignedByTrainerId: result.trainerId,
          consumed: false,
        })),
        customRecipes: (alt.customRecipes || []).map((cr) => ({
          ...(typeof cr.toObject === "function" ? cr.toObject() : cr),
          assignedByTrainerId: result.trainerId,
          consumed: false,
        })),
      }));

    if (meals.length) days.push({ date, meals });
  }

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return days;
}

module.exports = {
  resolveOwnedDietDay,
  resolveOwnedMealById,
  applyResolvedPlanToDietDay,
  resyncPlannedDays,
  clearAndResyncPlannedDays,
  getTrackingDaysForClient,
};
