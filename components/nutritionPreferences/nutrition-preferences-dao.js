const User = require("../users/user-schema");
const { DIETARY_FLAGS } = require("./nutrition-preferences-schema");

// Las preferencias viven en User.nutritionPreferences (2026-10). Este DAO
// devuelve la misma forma que devolvía el documento de la colección antigua
// (con `clientId` y todos los campos con su valor por defecto) para que
// controllers, servicios y apps no noten el cambio.

const DEFAULTS = {
  allergies: "",
  dietaryFlags: [],
  favoriteFoods: "",
  dislikedFoods: "",
  cooksAtHome: null,
  disabledMealSlots: [],
  mealSlotLabels: {},
  requestedAt: null,
  requestedBy: null,
  respondedAt: null,
  updatedAt: null,
};

const PATH = "nutritionPreferences";

function present(clientId, stored) {
  if (!stored) return null;
  return { clientId, ...DEFAULTS, ...stored };
}

const prefixed = (fields) => Object.fromEntries(Object.entries(fields).map(([key, value]) => [`${PATH}.${key}`, value]));

async function update(clientId, fields) {
  const user = await User.findOneAndUpdate(
    { _id: clientId },
    { $set: prefixed(fields) },
    { new: true, projection: { [PATH]: 1 }, runValidators: true },
  ).lean();
  return user ? present(user._id, user[PATH]) : null;
}

module.exports = {
  async getByClientId(clientId) {
    const user = await User.findById(clientId).select(PATH).lean();
    return user ? present(user._id, user[PATH]) : null;
  },

  async upsertOwnResponse(
    clientId,
    {
      allergies,
      favoriteFoods,
      dislikedFoods,
      cooksAtHome,
      dietaryFlags,
      disabledMealSlots,
      mealSlotLabels,
    }
  ) {
    const set = {
      allergies: allergies || "",
      favoriteFoods: favoriteFoods || "",
      dislikedFoods: dislikedFoods || "",
      cooksAtHome: cooksAtHome || null,
      disabledMealSlots: disabledMealSlots || [],
      respondedAt: new Date(),
      updatedAt: new Date(),
    };
    // Los formularios ya no renombran comidas: si no llega, se conserva lo
    // guardado (versiones antiguas de la app aún lo mandan).
    if (mealSlotLabels != null) set.mealSlotLabels = mealSlotLabels;
    // Solo se pisa si viene en la petición: versiones antiguas de la app
    // del cliente no mandan dietaryFlags.
    if (Array.isArray(dietaryFlags)) {
      set.dietaryFlags = dietaryFlags.filter((f) => DIETARY_FLAGS.includes(f));
    }
    return update(clientId, set);
  },

  async markRequested(clientId, trainerId) {
    return update(clientId, { requestedAt: new Date(), requestedBy: trainerId, updatedAt: new Date() });
  },
};
