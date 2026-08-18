const nutritionPreferencesDao = require("./nutrition-preferences-dao");
const dietDaysUtil = require("../dietDays/diet-days-util");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const notificationDao = require("../notifications/notification-dao");

const COOKS_AT_HOME_VALUES = ["yes", "no", "sometimes"];
const VALID_MEAL_SLOTS = Object.values(dietDaysUtil.MEALS);

module.exports = {
  // GET /nutrition-preferences — cliente, las suyas propias (o null si nunca respondió/solicitaron).
  async getMine(req, res) {
    const preferences = await nutritionPreferencesDao.getByClientId(req.auth.userId);
    return res.send(preferences);
  },

  // PUT /nutrition-preferences — cliente, rellena/edita y marca respondedAt.
  async updateMine(req, res) {
    const {
      allergies,
      favoriteFoods,
      dislikedFoods,
      cooksAtHome,
      disabledMealSlots,
      mealSlotLabels,
    } = req.body || {};

    if (cooksAtHome != null && !COOKS_AT_HOME_VALUES.includes(cooksAtHome)) {
      return res.status(400).send({ message: "cooksAtHome debe ser 'yes', 'no' o 'sometimes'" });
    }
    if ([allergies, favoriteFoods, dislikedFoods].some((v) => v != null && String(v).length > 1000)) {
      return res.status(400).send({ message: "Cada campo de texto no puede superar los 1000 caracteres" });
    }
    if (
      disabledMealSlots != null &&
      (!Array.isArray(disabledMealSlots) ||
        !disabledMealSlots.every((slot) => VALID_MEAL_SLOTS.includes(slot)))
    ) {
      return res.status(400).send({
        message: `disabledMealSlots solo admite: ${VALID_MEAL_SLOTS.join(", ")}`,
      });
    }
    if (
      mealSlotLabels != null &&
      (typeof mealSlotLabels !== "object" ||
        Array.isArray(mealSlotLabels) ||
        !Object.keys(mealSlotLabels).every((slot) => VALID_MEAL_SLOTS.includes(slot)) ||
        !Object.values(mealSlotLabels).every((label) => typeof label === "string" && label.length <= 50))
    ) {
      return res.status(400).send({
        message: `mealSlotLabels debe mapear slots válidos (${VALID_MEAL_SLOTS.join(", ")}) a textos de máximo 50 caracteres`,
      });
    }

    const preferences = await nutritionPreferencesDao.upsertOwnResponse(req.auth.userId, {
      allergies,
      favoriteFoods,
      dislikedFoods,
      cooksAtHome,
      disabledMealSlots,
      mealSlotLabels,
    });

    // Dashboard trainer (2026-08-18) — las preferencias no son por trainer
    // (una sola respuesta del cliente), así que avisa a TODOS los
    // profesionales con relación de nutrición activa, no solo a uno.
    const activeRelations = await trainerClientDao.findActiveByClient(req.auth.userId);
    const nutritionTrainerIds = [
      ...new Set(
        activeRelations.filter((r) => r.scope === "nutrition").map((r) => String(r.trainerId))
      ),
    ];
    await Promise.all(
      nutritionTrainerIds.map((trainerId) =>
        notificationDao.createForTrainer(trainerId, req.auth.userId, "nutrition_preferences_updated", {})
      )
    );

    return res.send(preferences);
  },
};
