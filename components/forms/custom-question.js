const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Preguntas propias del profesional, con tipo: las mismas en los check-ins
// (plantilla, programación y la copia de cada respuesta) y en el cuestionario
// de alta (User.trainerSettings.intake.customQuestions).
//
// Conviven con los campos de catálogo (`enabledFields`), que son CERRADOS
// porque tienen semántica conocida: el peso va a Anthropometry, el estrés
// alimenta las reglas, los perímetros pintan la evolución. Una pregunta
// propia no puede hacer nada de eso: solo se guarda la respuesta y se
// muestra. El tipo existe para que la respuesta sea comparable y se pueda
// validar: un "¿cómo has dormido?" que solo admite texto libre no se puede
// comparar entre dos semanas.

// Las opciones de "frecuencia" son fijas: es una escala ordinal con
// significado estable, no una lista que cada coach reinventa. Si cada uno
// escribiera las suyas, dos respuestas de dos coaches dejarían de ser
// comparables y el tipo no aportaría nada sobre un selector normal.
const FREQUENCY_OPTIONS = ["Nunca", "Rara vez", "A veces", "A menudo", "Siempre"];

const CUSTOM_QUESTION_TYPES = ["scale_1_5", "number", "text", "yes_no", "select", "frequency"];

const CustomQuestionSchema = new Schema({
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
  // Desactivar en vez de borrar deja de pedirla sin perder el texto (y las
  // respuestas ya recibidas siguen legibles).
  enabled: { type: Boolean, default: true },
});

// Check-ins: prefijo de la clave con la que la respuesta viaja dentro de
// CheckinResponse.values. Permite meter las respuestas propias en el MISMO
// Mixed que ya usan los campos del catálogo, sin colección ni campo aparte:
// el _id de la pregunta las distingue sin ambigüedad, y ningún campo del
// catálogo puede contener ":".
const CUSTOM_KEY_PREFIX = "custom:";

function customKeyFor(questionId) {
  return `${CUSTOM_KEY_PREFIX}${questionId}`;
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

/**
 * Respuestas a preguntas propias validadas contra sus preguntas, con el
 * enunciado, el tipo y la unidad copiados: siguen legibles aunque la
 * pregunta cambie o se borre después.
 *
 * `incoming`: [{ questionId, value }] tal como llega. `requireAll`: exige
 * las obligatorias y descarta lo anterior (envío del cliente). Sin él
 * (corrección del profesional), una pregunta sin respuesta nueva conserva la
 * de `previous`, y las de preguntas que ya no se piden se quedan como estaban.
 * Puro. Devuelve { answers } o { error }.
 */
function buildCustomAnswers(questions, incoming, { previous = [], requireAll = false } = {}) {
  const sent = new Map(
    (Array.isArray(incoming) ? incoming : [])
      .filter((answer) => answer && answer.questionId != null)
      .map((answer) => [String(answer.questionId), answer.value])
  );
  const kept = requireAll ? [] : previous;
  const answers = [];
  const asked = new Set();
  for (const question of (questions || []).filter((q) => q.enabled !== false)) {
    const id = String(question._id);
    asked.add(id);
    if (!sent.has(id) && !requireAll) {
      const before = kept.find((answer) => answer.questionId === id);
      if (before) answers.push(before);
      continue;
    }
    const value = sent.get(id);
    const error = validateCustomAnswer(requireAll ? question : { ...question, required: false }, value);
    if (error) return { error };
    if (value === undefined || value === null || value === "") continue;
    answers.push({
      questionId: id,
      label: question.label,
      type: question.type,
      unit: question.unit || "",
      value: normalizeCustomAnswer(question, value),
    });
  }
  for (const answer of kept) if (!asked.has(answer.questionId)) answers.push(answer);
  return { answers };
}

const MAX_CUSTOM_QUESTIONS = 20;

/** La lista entera de preguntas de una plantilla o cuestionario: primer error o null. */
function validateQuestionList(questions) {
  if (!Array.isArray(questions)) return "Las preguntas propias tienen que ser una lista";
  if (questions.length > MAX_CUSTOM_QUESTIONS) return `Como mucho ${MAX_CUSTOM_QUESTIONS} preguntas propias`;
  for (const question of questions) {
    const error = validateQuestionDefinition(question);
    if (error) return error;
  }
  return null;
}

/** Forma limpia de una pregunta para guardar (conserva su _id si ya lo tenía). */
function normalizeQuestionDefinition(question) {
  const id = question._id || question.id;
  return {
    ...(mongoose.isValidObjectId(id) ? { _id: id } : {}),
    label: String(question.label).trim(),
    type: question.type,
    unit: question.type === "number" ? String(question.unit || "").trim().slice(0, 20) : "",
    options: question.type === "select" ? (question.options || []).map((o) => String(o).trim()).filter(Boolean) : [],
    required: Boolean(question.required),
    enabled: question.enabled !== false,
  };
}

module.exports = {
  CustomQuestionSchema,
  MAX_CUSTOM_QUESTIONS,
  validateQuestionList,
  normalizeQuestionDefinition,
  buildCustomAnswers,
  CUSTOM_QUESTION_TYPES,
  FREQUENCY_OPTIONS,
  CUSTOM_KEY_PREFIX,
  customKeyFor,
  validateCustomAnswer,
  normalizeCustomAnswer,
  validateQuestionDefinition,
};
