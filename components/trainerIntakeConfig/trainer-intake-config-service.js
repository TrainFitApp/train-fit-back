const trainerIntakeConfigDao = require("./trainer-intake-config-dao");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");
const { validateQuestionList, normalizeQuestionDefinition } = require("../forms/custom-question");
const { badRequest } = require("../util/http-error");

const VALID_SCOPES = ["training", "nutrition"];

const plain = (question) => (typeof question.toObject === "function" ? question.toObject() : question);

function present(trainerId, config) {
  return {
    trainerId,
    enabledFields: config ? config.enabledFields : [...INTAKE_FIELD_KEYS],
    customQuestions: config ? (config.customQuestions || []).map(plain) : [],
    lastScopes: config ? config.lastScopes || [] : [],
  };
}

module.exports = {
  async getMyConfig(trainerId) {
    return present(trainerId, await trainerIntakeConfigDao.getByTrainer(trainerId));
  },

  async updateMyConfig(trainerId, { enabledFields = [], customQuestions = [], lastScopes = [] } = {}) {
    if (!Array.isArray(enabledFields) || !enabledFields.every((f) => INTAKE_FIELD_KEYS.includes(f))) {
      throw badRequest("enabledFields contiene una clave no reconocida en el catálogo", "INVALID_INTAKE_FIELDS");
    }
    const questionError = validateQuestionList(customQuestions);
    if (questionError) throw badRequest(questionError, "INVALID_CUSTOM_QUESTIONS");
    if (!Array.isArray(lastScopes) || !lastScopes.every((s) => VALID_SCOPES.includes(s))) {
      throw badRequest("lastScopes solo admite 'training'/'nutrition'", "INVALID_LAST_SCOPES");
    }
    const config = await trainerIntakeConfigDao.upsert(
      trainerId,
      enabledFields,
      customQuestions.map(normalizeQuestionDefinition),
      lastScopes
    );
    return present(trainerId, config);
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
