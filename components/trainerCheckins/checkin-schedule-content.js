const { CHECKIN_FIELDS_BY_KEY } = require("./checkin-field-catalog");

// PURO — las preguntas de una programación de check-in: de una plantilla de
// la biblioteca o elegidas campo a campo.

// Timing por defecto al aplicar una plantilla desde la biblioteca: empieza
// hoy (el del entrenador, que es quien la aplica), semanal. El entrenador lo
// afina después en la ficha del cliente — aplicar no debería obligar a
// rellenar un formulario de fechas.
function defaultTiming(today) {
  return { startDate: today, time: "09:00", frequency: "weekly", interval: 1 };
}

function scheduleContent(definition) {
  return {
    name: definition.name,
    sourceTemplateId: definition._id,
    enabledFields: definition.enabledFields || [],
    requiredFields: definition.requiredFields || [],
    customQuestions: (definition.customQuestions || []).map((q) => (typeof q.toObject === "function" ? q.toObject() : q)),
  };
}

// Preguntas elegidas campo a campo, sin plantilla: solo claves del catálogo,
// sin repetir, ninguna obligatoria y sin preguntas propias. null si alguna
// clave no existe.
function looseContent(fields) {
  const enabledFields = [...new Set(fields)];
  if (enabledFields.some((key) => !CHECKIN_FIELDS_BY_KEY.has(key))) return null;
  return { sourceTemplateId: null, enabledFields, requiredFields: [], customQuestions: [] };
}

function hasQuestions(content) {
  return !!content.enabledFields?.length || !!content.customQuestions?.some((q) => q.enabled !== false);
}

module.exports = { defaultTiming, scheduleContent, looseContent, hasQuestions };
