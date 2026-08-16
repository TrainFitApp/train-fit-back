const nutritionPreferencesDao = require("./nutrition-preferences-dao");
const trainerClientAccess = require("../trainerClients/trainer-client-access");
const userSchema = require("../users/schema");
const mail = require("../util/mail");
const notificationService = require("../notifications/notification-service");

const EDITABLE_FIELDS = [
  "allergies",
  "favoriteFoods",
  "dislikedFoods",
  "cooksAtHome",
  "disabledMealSlots",
  "mealSlotLabels",
];

function notifyRequested(clientEmail, trainerName) {
  const header = `${trainerName || "Tu entrenador"} te pide actualizar tus preferencias`;
  const description = `${
    trainerName || "Tu entrenador"
  } te ha pedido que revises y actualices tus preferencias nutricionales (alergias, comidas favoritas, franjas de comida) en la app TrainFit.`;

  mail
    .sendMailSES(
      clientEmail,
      "Actualiza tus preferencias nutricionales - TrainFit",
      mail.generateNotificationMail(header, description, [])
    )
    .catch((error) => {
      console.error("[NUTRITION_PREFERENCES] request_email_failed", {
        clientEmail,
        message: error?.message,
      });
    });
}

module.exports = {
  async getMine(clientId) {
    return nutritionPreferencesDao.findByClientId(clientId);
  },

  async updateMine(clientId, payload) {
    const fields = {};
    EDITABLE_FIELDS.forEach((key) => {
      if (payload[key] !== undefined) fields[key] = payload[key];
    });
    return nutritionPreferencesDao.upsertByClient(clientId, fields);
  },

  // De un cliente a la vez, por consistencia con las funcionalidades 6/7/8.
  async requestUpdate(trainerId, clientId) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");

    const [trainer, client] = await Promise.all([
      userSchema.findById(trainerId).select("name lastname"),
      userSchema.findById(clientId).select("email"),
    ]);

    const updated = await nutritionPreferencesDao.markRequested(clientId, trainerId);

    if (client?.email) {
      const trainerName = `${trainer?.name || ""} ${trainer?.lastname || ""}`.trim();
      notifyRequested(client.email, trainerName);
    }

    notificationService.notifyClient(
      clientId,
      trainerId,
      "preferences_requested",
      "ClientNutritionPreferences",
      updated?._id || null
    );

    return updated;
  },

  // Lado trainer, de solo lectura — ver qué respondió el cliente.
  async getForClient(trainerId, clientId) {
    await trainerClientAccess.requireActiveRelation(trainerId, clientId, "nutrition");
    return nutritionPreferencesDao.findByClientId(clientId);
  },
};
