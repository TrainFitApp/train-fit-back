const trainerIntakeConfigDao = require("./trainer-intake-config-dao");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

const MAX_CUSTOM_QUESTIONS = 20;
const VALID_SCOPES = ["training", "nutrition"];

function validateCustomQuestions(customQuestions) {
  if (!Array.isArray(customQuestions)) return false;
  if (customQuestions.length > MAX_CUSTOM_QUESTIONS) return false;
  return customQuestions.every(
    (q) => q && typeof q.label === "string" && q.label.trim().length > 0 && q.label.trim().length <= 200
  );
}

function validateLastScopes(lastScopes) {
  return Array.isArray(lastScopes) && lastScopes.every((s) => VALID_SCOPES.includes(s));
}

// Los subdocumentos de Mongoose vienen con `_id` en el lean() — se exponen
// como `id` (string) hacia el frontend para no filtrar el detalle de
// Mongoose y mantener la misma forma que el resto de modelos del API.
function toPublicQuestion(q) {
  return { id: String(q._id), label: q.label, enabled: q.enabled !== false };
}

module.exports = {
  async getMyConfig(trainerId) {
    const config = await trainerIntakeConfigDao.getByTrainer(trainerId);
    return {
      trainerId,
      enabledFields: config ? config.enabledFields : [...INTAKE_FIELD_KEYS],
      customQuestions: config ? (config.customQuestions || []).map(toPublicQuestion) : [],
      lastScopes: config ? config.lastScopes || [] : [],
    };
  },

  async updateMyConfig(trainerId, enabledFields, customQuestions = [], lastScopes = []) {
    if (!Array.isArray(enabledFields) || !enabledFields.every((f) => INTAKE_FIELD_KEYS.includes(f))) {
      const err = new Error("enabledFields contiene una clave no reconocida en el catálogo");
      err.code = "INVALID_INTAKE_FIELDS";
      throw err;
    }
    if (!validateCustomQuestions(customQuestions)) {
      const err = new Error("customQuestions contiene una pregunta inválida (label vacío o demasiado largo)");
      err.code = "INVALID_CUSTOM_QUESTIONS";
      throw err;
    }
    if (!validateLastScopes(lastScopes)) {
      const err = new Error("lastScopes solo admite 'training'/'nutrition'");
      err.code = "INVALID_LAST_SCOPES";
      throw err;
    }
    const normalized = customQuestions.map((q) => ({ label: q.label.trim(), enabled: q.enabled !== false }));
    const config = await trainerIntakeConfigDao.upsert(trainerId, enabledFields, normalized, lastScopes);
    return {
      trainerId,
      enabledFields: config.enabledFields,
      customQuestions: (config.customQuestions || []).map(toPublicQuestion),
      lastScopes: config.lastScopes || [],
    };
  },

  async getEnabledFieldsByTrainer(trainerId) {
    return trainerIntakeConfigDao.getEnabledFieldsByTrainer(trainerId);
  },

  async getEnabledFieldsByTrainers(trainerIds) {
    return trainerIntakeConfigDao.getEnabledFieldsByTrainers(trainerIds);
  },

  async getCustomQuestionsByTrainers(trainerIds) {
    return trainerIntakeConfigDao.getCustomQuestionsByTrainers(trainerIds);
  },
};
