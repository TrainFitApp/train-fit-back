const tableService = require("../tables/table-service");
const mealService = require("../meals/meal-service");
const notificationService = require("../notifications/notification-service");
const trainerClientService = require("./trainer-client-service");
const { resolveOwnedDietDay } = require("../dietDays/diet-day-resolver");
const { badRequest } = require("../util/http-error");

// Lo que el profesional pauta directamente a sus clientes, a uno (F11/F12) o
// a varios a la vez (F30): una rutina (en blanco o copia de una plantilla) y
// el contenido de una comida. La comida avisa al cliente en el acto; la
// rutina, al PROGRAMARLA (routine-assignment-service.js#applyRoutine): recién
// creada es un borrador que el cliente no ve, y el aviso le mandaba a buscar
// algo que no encontraba.

// La misma operación sobre varios clientes, cada uno con su comprobación de
// relación activa (nunca se salta "porque es en bloque") y su resultado: un
// fallo en uno no aborta el resto.
async function applyToTargets(trainerId, targetClientIds, scope, operation) {
  if (!Array.isArray(targetClientIds) || !targetClientIds.length) {
    throw badRequest("Debes seleccionar al menos un cliente destino");
  }
  const settled = await Promise.allSettled(
    targetClientIds.map(async (clientId) => {
      if (!(await trainerClientService.hasActiveClient(trainerId, clientId, scope))) {
        throw new Error("No tienes una relación activa con este cliente");
      }
      await operation(clientId);
    }),
  );
  return targetClientIds.map((clientId, index) => {
    const result = settled[index];
    if (result.status === "fulfilled") return { clientId, success: true };
    return { clientId, success: false, error: result.reason?.message || "Error desconocido" };
  });
}

async function copyTemplate(trainerId, clientId, sourceTableId) {
  return tableService.assignTemplateToClient(clientId, sourceTableId, trainerId);
}

const clipboardOf = ({ customProducts, customRecipes }) => ({
  customProducts: customProducts || [],
  customRecipes: customRecipes || [],
});

// pasteMeal marca cada alimento nuevo como pautado. La comida entera solo se
// bloquea al reemplazar: al combinar sigue siendo mixta (lo del cliente y lo
// recién pautado) y la protección por alimento ya cubre lo del profesional.
async function pasteIntoMeal(trainerId, clientId, date, meal, clipboard, merge) {
  const updated = await mealService.pasteMeal(clipboard, meal, merge, trainerId);
  if (!merge) await mealService.markAssignedByTrainer(meal._id, trainerId);
  await notificationService.create(clientId, trainerId, "meal_prescribed", { date, mealName: meal.name });
  return updated;
}

// La comida de un cliente en una fecha, por su nombre (cada cliente tiene un
// id distinto para el mismo hueco).
async function mealBySlot(clientId, date, mealSlot) {
  const dietDay = await resolveOwnedDietDay(clientId, date);
  const meal = (dietDay.meals || []).find((candidate) => candidate.name === mealSlot);
  if (!meal) throw new Error(`No existe la comida "${mealSlot}" para este cliente en esta fecha`);
  return meal;
}

module.exports = {
  // F11: { mode: "new", name } | { mode: "duplicate", sourceTableId }.
  async assignRoutine({ trainerId, clientId, mode, name, sourceTableId }) {
    if (mode === "new") {
      if (!name) throw badRequest("name es obligatorio");
      return tableService.assignNewRoutineToClient(clientId, name, trainerId);
    }
    if (mode === "duplicate") {
      if (!sourceTableId) throw badRequest("sourceTableId es obligatorio");
      return copyTemplate(trainerId, clientId, sourceTableId);
    }
    throw badRequest('mode debe ser "new" o "duplicate"');
  },

  // F12: la comida se resuelve contra el cliente de la ruta antes de tocar
  // nada; nunca se confía en un id de comida suelto.
  async prescribeMeal({ trainerId, clientId, date, mealId, merge, ...content }) {
    const dietDay = await resolveOwnedDietDay(clientId, date);
    const meal = (dietDay.meals || []).find((candidate) => String(candidate._id) === String(mealId));
    if (!meal) throw badRequest("La comida indicada no pertenece a este cliente en esta fecha", "MEAL_NOT_FOUND");
    return pasteIntoMeal(trainerId, clientId, date, meal, clipboardOf(content), Boolean(merge));
  },

  // F30: una plantilla (pública o propia) a varios clientes.
  applyRoutineToClients(trainerId, routineId, targetClientIds) {
    return applyToTargets(trainerId, targetClientIds, "training", (clientId) => copyTemplate(trainerId, clientId, routineId));
  },

  // F30: el mismo contenido en la comida `mealSlot` de `date` de varios
  // clientes.
  applyMealToClients(trainerId, { date, mealSlot, targetClientIds, merge, ...content }) {
    if (!date || !mealSlot) throw badRequest("date y mealSlot son obligatorios");
    const clipboard = clipboardOf(content);
    return applyToTargets(trainerId, targetClientIds, "nutrition", async (clientId) => {
      const meal = await mealBySlot(clientId, date, mealSlot);
      await pasteIntoMeal(trainerId, clientId, date, meal, clipboard, Boolean(merge));
    });
  },
};
