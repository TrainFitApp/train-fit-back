const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase 5 Coach Pro — preguntas propias del coach dentro de un check-in (§7).
//
// Convive con `enabledFields`, que es y sigue siendo un catálogo CERRADO
// (checkin-field-catalog.js): esos campos tienen semántica conocida — el
// peso va a Anthropometry, el estrés alimenta las reglas, los perímetros
// pintan la evolución. Una pregunta libre no puede hacer nada de eso, y
// pretenderlo sería el error: aquí solo se guarda la respuesta y se muestra.
//
// Mismo patrón que TrainerIntakeConfig.customQuestions (cuestionario
// inicial), pero CON TIPO: un check-in se responde cada semana, así que un
// "¿cómo has dormido?" que solo admita texto libre se vuelve inútil para
// comparar dos semanas. De ahí los seis tipos de §7.

// Las opciones de "frecuencia" son fijas: es una escala ordinal con
// significado estable, no una lista que cada coach reinventa. Si cada uno
// escribiera las suyas, dos respuestas de dos coaches dejarían de ser
// comparables y el tipo no aportaría nada sobre un selector normal.
const FREQUENCY_OPTIONS = ["Nunca", "Rara vez", "A veces", "A menudo", "Siempre"];

const CUSTOM_QUESTION_TYPES = ["scale_1_5", "number", "text", "yes_no", "select", "frequency"];

const CustomCheckinQuestionSchema = new Schema({
  label: { type: String, required: true, trim: true, maxlength: 200 },
  type: { type: String, required: true, enum: CUSTOM_QUESTION_TYPES },
  // Solo para `number` ("horas", "km"...). Puramente informativo.
  unit: { type: String, trim: true, maxlength: 20, default: "" },
  // Solo para `select`. `frequency` usa FREQUENCY_OPTIONS y las ignora.
  options: {
    type: [String],
    default: [],
    validate: {
      validator: (options) => options.length <= 10,
      message: "Una pregunta de selección admite como mucho 10 opciones",
    },
  },
  // Obligatoria = el cliente no puede enviar el check-in sin responderla.
  required: { type: Boolean, default: false },
  // Desactivar en vez de borrar conserva las respuestas ya recibidas con
  // su pregunta legible — mismo criterio que TrainerTask.active y que las
  // preguntas del cuestionario inicial.
  enabled: { type: Boolean, default: true },
});

// Prefijo de la clave con la que la respuesta viaja dentro de
// CheckinResponse.values. Permite meter las respuestas propias en el MISMO
// Mixed que ya usan los campos del catálogo, sin colección ni campo aparte:
// el _id de la pregunta las distingue sin ambigüedad, y ningún campo del
// catálogo puede contener ":".
const CUSTOM_KEY_PREFIX = "custom:";

function customKeyFor(questionId) {
  return `${CUSTOM_KEY_PREFIX}${questionId}`;
}

function isCustomKey(key) {
  return typeof key === "string" && key.startsWith(CUSTOM_KEY_PREFIX);
}

function questionIdFromKey(key) {
  return isCustomKey(key) ? key.slice(CUSTOM_KEY_PREFIX.length) : null;
}

/**
 * Valida una respuesta contra su pregunta. Devuelve un mensaje de error o
 * null. Puro — se prueba sin BD.
 */
function validateCustomAnswer(question, value) {
  const isEmpty = value === null || value === undefined || value === "";

  if (isEmpty) {
    return question.required ? `"${question.label}" es obligatoria` : null;
  }

  switch (question.type) {
    case "scale_1_5":
      if (!Number.isFinite(Number(value)) || Number(value) < 1 || Number(value) > 5) {
        return `"${question.label}" debe estar entre 1 y 5`;
      }
      return null;

    case "number":
      if (!Number.isFinite(Number(value))) return `"${question.label}" debe ser un número`;
      if (Number(value) < 0) return `"${question.label}" no puede ser negativo`;
      return null;

    case "text":
      if (typeof value !== "string") return `"${question.label}" debe ser texto`;
      if (value.length > 1000) return `"${question.label}" no puede superar 1000 caracteres`;
      return null;

    case "yes_no":
      // Se acepta el booleano y también sus formas de texto: los <select>
      // del formulario devuelven strings, y rechazar "true" obligaría a
      // cada cliente a acordarse de convertirlo.
      if (typeof value === "boolean") return null;
      if (value === "true" || value === "false") return null;
      return `"${question.label}" solo admite sí o no`;

    case "select":
      if (!(question.options || []).includes(String(value))) {
        return `"${question.label}" no admite ese valor`;
      }
      return null;

    case "frequency":
      if (!FREQUENCY_OPTIONS.includes(String(value))) {
        return `"${question.label}" no admite ese valor`;
      }
      return null;

    default:
      return `"${question.label}" tiene un tipo no reconocido`;
  }
}

/** Normaliza el valor a guardar: recorta texto y convierte sí/no a booleano. */
function normalizeCustomAnswer(question, value) {
  if (question.type === "text") return String(value).trim();
  if (question.type === "yes_no") return value === true || value === "true";
  if (question.type === "scale_1_5" || question.type === "number") return Number(value);
  return value;
}

/** Comprueba la forma de una pregunta al crearla/editarla. */
function validateQuestionDefinition(question) {
  if (!question?.label || !String(question.label).trim()) {
    return "Cada pregunta necesita un enunciado";
  }
  if (!CUSTOM_QUESTION_TYPES.includes(question.type)) {
    return `Tipo de pregunta no reconocido: ${question.type}`;
  }
  if (question.type === "select") {
    const options = (question.options || []).filter((o) => String(o).trim());
    if (options.length < 2) {
      return `"${question.label}" necesita al menos 2 opciones para elegir`;
    }
  }
  return null;
}

module.exports = {
  CustomCheckinQuestionSchema,
  CUSTOM_QUESTION_TYPES,
  FREQUENCY_OPTIONS,
  CUSTOM_KEY_PREFIX,
  customKeyFor,
  isCustomKey,
  questionIdFromKey,
  validateCustomAnswer,
  normalizeCustomAnswer,
  validateQuestionDefinition,
};
