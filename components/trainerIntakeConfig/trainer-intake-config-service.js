const trainerIntakeConfigDao = require("./trainer-intake-config-dao");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");
const {
  normalizeMeasurementRequests,
  normalizePhotoRequest,
  normalizeVideoRequests,
  intakeFormOf,
} = require("./intake-requests");
const { validateQuestionList, normalizeQuestionDefinition } = require("../forms/custom-question");
const { badRequest } = require("../util/http-error");

const VALID_SCOPES = ["training", "nutrition"];

const plain = (item) => (item && typeof item.toObject === "function" ? item.toObject() : item);

// La configuración de un profesional tal y como la usan la app y el resto
// del back. Sin guardar todavía: todos los campos del catálogo y nada más
// (ni preguntas propias, ni medidas, ni fotos, ni vídeos).
function present(trainerId, config) {
  return {
    trainerId,
    enabledFields: config ? config.enabledFields : [...INTAKE_FIELD_KEYS],
    customQuestions: config ? (config.customQuestions || []).map(plain) : [],
    measurements: config ? (config.measurements || []).map(plain) : [],
    photos: config?.photos ? plain(config.photos) : null,
    videos: config ? (config.videos || []).map(plain) : [],
    lastScopes: config ? config.lastScopes || [] : [],
  };
}

function checked(result, code) {
  if (result.error) throw badRequest(result.error, code);
  return result.value;
}

module.exports = {
  async getMyConfig(trainerId) {
    return present(trainerId, await trainerIntakeConfigDao.getByTrainer(trainerId));
  },

  async updateMyConfig(
    trainerId,
    { enabledFields = [], customQuestions = [], measurements = [], photos = null, videos = [], lastScopes = [] } = {}
  ) {
    if (!Array.isArray(enabledFields) || !enabledFields.every((f) => INTAKE_FIELD_KEYS.includes(f))) {
      throw badRequest("enabledFields contiene una clave no reconocida en el catálogo", "INVALID_INTAKE_FIELDS");
    }
    const questionError = validateQuestionList(customQuestions);
    if (questionError) throw badRequest(questionError, "INVALID_CUSTOM_QUESTIONS");
    if (!Array.isArray(lastScopes) || !lastScopes.every((s) => VALID_SCOPES.includes(s))) {
      throw badRequest("lastScopes solo admite 'training'/'nutrition'", "INVALID_LAST_SCOPES");
    }
    const config = await trainerIntakeConfigDao.upsert(trainerId, {
      enabledFields,
      customQuestions: customQuestions.map(normalizeQuestionDefinition),
      measurements: checked(normalizeMeasurementRequests(measurements), "INVALID_INTAKE_MEASUREMENTS"),
      photos: checked(normalizePhotoRequest(photos), "INVALID_INTAKE_PHOTOS"),
      videos: checked(normalizeVideoRequests(videos), "INVALID_INTAKE_VIDEOS"),
      lastScopes,
    });
    return present(trainerId, config);
  },

  /**
   * El formulario que se copia al par al invitar (TrainerClient.intakeForm):
   * lo que el profesional tiene activo ahora mismo.
   */
  async intakeFormFor(trainerId) {
    const stored = await trainerIntakeConfigDao.getByTrainer(trainerId);
    return intakeFormOf(stored ? present(trainerId, stored) : null);
  },
};
