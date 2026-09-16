// Necesidad del cliente por ciclo (docs/plan-info-calculo-fase.md) — la
// parte PURA: pasos hechos a partir del check-in del ciclo y la forma del
// snapshot que se guarda en el head de la fase / se devuelve al vuelo para
// los ciclos 2+.
// Lo que toca BD vive en plan-assignment-service.js#getCycleNeed.

/**
 * Pasos hechos según la respuesta de check-in del ciclo: el campo
 * `daily_steps` del catálogo (media diaria que declara el cliente). Sin
 * respuesta, sin el campo o con un valor no válido → avg null.
 * @returns {{ avg: number|null, respondedAt: Date|null }}
 */
function stepsFromCheckin(response) {
  const raw = response?.values?.daily_steps;
  const n = Number(raw);
  if (raw === null || raw === undefined || raw === "" || !Number.isFinite(n) || n <= 0) {
    return { avg: null, respondedAt: null };
  }
  return { avg: Math.round(n), respondedAt: response.respondedAt || null };
}

/**
 * Snapshot a partir de lo que devuelve resolveClientNutritionTarget. Misma
 * forma tanto si se persiste (C1) como si se calcula al vuelo (C2+), para
 * que el front pinte una sola cosa.
 */
function needSnapshot(resolved, computedAt = new Date()) {
  if (!resolved) return null;
  if (!resolved.ok) {
    return { computedAt, missing: resolved.missing, inputs: resolved.inputs, breakdown: null, target: null };
  }
  return {
    computedAt,
    missing: undefined,
    inputs: resolved.inputs,
    breakdown: resolved.breakdown,
    target: resolved.target,
  };
}

module.exports = { stepsFromCheckin, needSnapshot };
