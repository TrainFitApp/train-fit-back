// Gathering de biométricos + guard + cálculo del target de un cliente,
// compartido entre el cajón de sugerencias de dieta
// (dietTemplates/diet-suggestion-controller.js#suggest) y el endpoint ligero
// de "recomendar objetivo" del panel de asignar objetivos
// (trainerClients/trainer-client-data-controller.js#getNutritionTarget).
// Extraído para no mantener la misma lógica de guard/fallback de peso en
// dos sitios (antes solo vivía en diet-suggestion-controller.js).

const userSchema = require("../users/schema");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { computeNutritionTarget } = require("./nutrition-target");

function ageFromBirth(birth) {
  if (!birth) return null;
  const ms = Date.now() - new Date(birth).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms / (1000 * 3600 * 24) / 365.25);
}

/**
 * @returns {{ ok: true, target, weightSource, clientObjetive }
 *          | { ok: false, missing: string[] }}
 */
async function resolveClientNutritionTarget(clientId, objetiveKcalDelta = 0) {
  const [user, anthros] = await Promise.all([
    userSchema.findById(clientId).select("sex height birth activity steps training weight objetive").lean(),
    anthropometryDao.getAllAnthropometriesByUserId(clientId),
  ]);

  // El peso sale de la última antropometría; si el cliente todavía no tiene
  // ninguna (recién registrado, invitado por un entrenador), se usa el que
  // metió en el registro (`User.weight`).
  const latestAnthroWeight = (anthros || []).find((a) => Number.isFinite(a.weight));
  const weightKg = latestAnthroWeight?.weight ?? (Number.isFinite(user?.weight) ? user.weight : null);
  const weightSource = latestAnthroWeight
    ? { weightKg: latestAnthroWeight.weight, date: latestAnthroWeight.date, from: "anthropometry" }
    : weightKg !== null
    ? { weightKg, from: "signup" }
    : null;
  const age = ageFromBirth(user?.birth);

  // Guard — sin biométricos no hay objetivo (mismo criterio que la pantalla
  // de objetivo del cliente).
  const missing = [];
  if (weightKg === null) missing.push("peso");
  if (!user?.height) missing.push("altura");
  if (age === null) missing.push("fecha de nacimiento");
  if (user?.sex === undefined || user?.sex === null) missing.push("sexo");
  if (missing.length) return { ok: false, missing };

  const target = computeNutritionTarget({
    weightKg,
    heightCm: user.height,
    age,
    sex: user.sex,
    activity: user.activity,
    steps: user.steps,
    training: user.training,
    objetiveKcalDelta,
  });

  return {
    ok: true,
    target,
    weightSource,
    // El objetivo que el cliente eligió al registrarse (delta kcal con
    // signo) — para que el panel arranque en Definir/Mantener/Volumen en
    // vez de siempre Definir.
    clientObjetive: Number.isFinite(user.objetive) ? user.objetive : null,
  };
}

module.exports = { resolveClientNutritionTarget };
