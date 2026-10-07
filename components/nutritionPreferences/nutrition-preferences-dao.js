const User = require("../users/user-schema");
const { DIETARY_FLAGS } = require("./nutrition-preferences-schema");

// Las preferencias viven en User.nutritionPreferences. Se devuelven con el
// `clientId` de su dueño y todos los campos con su valor por defecto; null si
// nunca se pidieron ni respondieron.

const DEFAULTS = {
  allergies: "",
  dietaryFlags: [],
  favoriteFoods: "",
  dislikedFoods: "",
  cooksAtHome: null,
  disabledMealSlots: [],
  requestedAt: null,
  requestedBy: null,
  respondedAt: null,
  updatedAt: null,
};

// Lo que el cliente responde, normalizado: vacío = "" / null / [].
const RESPONSE_FIELDS = {
  allergies: (value) => value || "",
  favoriteFoods: (value) => value || "",
  dislikedFoods: (value) => value || "",
  cooksAtHome: (value) => value || null,
  dietaryFlags: (value) => (value || []).filter((flag) => DIETARY_FLAGS.includes(flag)),
  disabledMealSlots: (value) => value || [],
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

  // Escribe los campos que llegan; uno ausente no se toca. Los formularios de
  // preferencias los mandan todos; el cuestionario de alta, solo los suyos
  // (nunca las comidas desactivadas, que no pregunta).
  async upsertOwnResponse(clientId, fields) {
    const set = { respondedAt: new Date(), updatedAt: new Date() };
    for (const [field, normalize] of Object.entries(RESPONSE_FIELDS)) {
      if (fields?.[field] !== undefined) set[field] = normalize(fields[field]);
    }
    return update(clientId, set);
  },

  async markRequested(clientId, trainerId) {
    return update(clientId, { requestedAt: new Date(), requestedBy: trainerId, updatedAt: new Date() });
  },
};
