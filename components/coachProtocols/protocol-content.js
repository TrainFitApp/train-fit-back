const { FREQUENCIES, validTime } = require("../trainerCheckins/checkin-schedule-dates");

// PURO. Lo que un protocolo programa y fija al aplicarse: sus check-ins (cada
// uno con su cadencia) y el objetivo de kcal y macros.

// Mismo margen que el editor de objetivos (macro-adjust#MACRO_KCAL_TOLERANCE):
// fuera de él los macros no cuadran con las kcal.
const MACRO_KCAL_TOLERANCE = 25;
const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 };
const ID_RE = /^[a-f\d]{24}$/i;

const DEFAULT_CADENCE = { frequency: "weekly", interval: 1, time: "09:00" };

function normalizeCheckins(list) {
  return (Array.isArray(list) ? list : []).map((c) => ({
    templateId: c?.templateId ? String(c.templateId) : null,
    frequency: c?.frequency || DEFAULT_CADENCE.frequency,
    interval: c?.interval === undefined || c?.interval === null ? 1 : Number(c.interval),
    time: c?.time || DEFAULT_CADENCE.time,
  }));
}

function validateCheckins(list) {
  const seen = new Set();
  for (const c of list) {
    if (!ID_RE.test(c.templateId || "")) return "Elige la plantilla de cada check-in";
    // La programación de un cliente se identifica por su plantilla de origen:
    // dos con la misma se pisarían al aplicar.
    if (seen.has(c.templateId)) return "No repitas la misma plantilla de check-in";
    seen.add(c.templateId);
    if (!FREQUENCIES.includes(c.frequency)) return "Frecuencia de check-in no válida";
    if (!Number.isInteger(c.interval) || c.interval < 1 || c.interval > 52) {
      return "El intervalo del check-in debe estar entre 1 y 52";
    }
    if (!validTime(c.time)) return "Hora de check-in no válida";
  }
  return null;
}

function macroKcal(t) {
  return t.protein * KCAL_PER_G.protein + t.carbs * KCAL_PER_G.carbs + t.fat * KCAL_PER_G.fat;
}

// null = el protocolo no toca el objetivo nutricional.
function normalizeNutritionTarget(input) {
  if (!input) return null;
  const round1 = (v) => Math.round(Number(v) * 10) / 10;
  return {
    kcal: Math.round(Number(input.kcal)),
    protein: round1(input.protein),
    carbs: round1(input.carbs),
    fat: round1(input.fat),
  };
}

function validateNutritionTarget(target) {
  if (!target) return null;
  if (!(target.kcal > 0) || target.kcal > 10000) return "Las kcal del objetivo deben estar entre 1 y 10000";
  if (["protein", "carbs", "fat"].some((k) => !Number.isFinite(target[k]) || target[k] < 0)) {
    return "Los macros del objetivo no pueden ser negativos";
  }
  const diff = Math.round(macroKcal(target) - target.kcal);
  if (Math.abs(diff) > MACRO_KCAL_TOLERANCE) {
    return `Los macros suman ${Math.round(macroKcal(target))} kcal y el objetivo es de ${target.kcal}: tienen que cuadrar`;
  }
  return null;
}

module.exports = {
  MACRO_KCAL_TOLERANCE,
  normalizeCheckins,
  validateCheckins,
  normalizeNutritionTarget,
  validateNutritionTarget,
};
