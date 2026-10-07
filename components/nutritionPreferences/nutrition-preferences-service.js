const nutritionPreferencesDao = require("./nutrition-preferences-dao");
const dietDaysUtil = require("../dietDays/diet-days-util");
const notificationService = require("../notifications/notification-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { badRequest } = require("../util/http-error");
const { DIETARY_FLAGS } = require("./nutrition-preferences-schema");

// Preferencias y restricciones de nutrición del cliente (dentro del usuario,
// nutrition-preferences-dao.js). Las responde el cliente o las rellena su
// profesional: misma validación para los dos.

const COOKS_AT_HOME_VALUES = ["yes", "no", "sometimes"];
const VALID_MEAL_SLOTS = Object.values(dietDaysUtil.MEALS);

/** Los campos de la respuesta, validados (400 si alguno no vale). */
function parseResponse(body) {
  const { allergies, favoriteFoods, dislikedFoods, cooksAtHome, dietaryFlags, disabledMealSlots } = body || {};

  if (cooksAtHome != null && !COOKS_AT_HOME_VALUES.includes(cooksAtHome)) {
    throw badRequest("cooksAtHome debe ser 'yes', 'no' o 'sometimes'");
  }
  if (dietaryFlags != null && (!Array.isArray(dietaryFlags) || !dietaryFlags.every((flag) => DIETARY_FLAGS.includes(flag)))) {
    throw badRequest(`dietaryFlags solo admite: ${DIETARY_FLAGS.join(", ")}`);
  }
  if ([allergies, favoriteFoods, dislikedFoods].some((v) => v != null && String(v).length > 1000)) {
    throw badRequest("Cada campo de texto no puede superar los 1000 caracteres");
  }
  if (
    disabledMealSlots != null &&
    (!Array.isArray(disabledMealSlots) || !disabledMealSlots.every((slot) => VALID_MEAL_SLOTS.includes(slot)))
  ) {
    throw badRequest(`disabledMealSlots solo admite: ${VALID_MEAL_SLOTS.join(", ")}`);
  }
  return { allergies, favoriteFoods, dislikedFoods, cooksAtHome, dietaryFlags, disabledMealSlots };
}

module.exports = {
  parseResponse,

  getForClient: (clientId) => nutritionPreferencesDao.getByClientId(clientId),

  // El cliente responde. Las preferencias no son por profesional (una sola
  // respuesta), así que se avisa a TODOS los que le llevan la nutrición.
  async saveClientResponse(clientId, body) {
    const preferences = await nutritionPreferencesDao.upsertOwnResponse(clientId, parseResponse(body));
    const trainerIds = [...(await trainerClientDao.findActiveTrainerIds(clientId, "nutrition"))];
    await Promise.all(
      trainerIds.map((trainerId) => notificationService.createForTrainer(trainerId, clientId, "nutrition_preferences_updated", {}))
    );
    return preferences;
  },

  // El profesional las rellena por el cliente en vez de esperar al cuestionario.
  async saveByTrainer(clientId, body) {
    return nutritionPreferencesDao.upsertOwnResponse(clientId, parseResponse(body));
  },

  // El profesional se las pide. Un fallo al avisar no deshace la petición.
  async request(clientId, trainerId) {
    const preferences = await nutritionPreferencesDao.markRequested(clientId, trainerId);
    try {
      await notificationService.create(clientId, trainerId, "nutrition_preferences_requested", {});
    } catch (e) {
      console.error("[nutrition-preferences] No se pudo notificar al cliente:", e.message);
    }
    return preferences;
  },
};
