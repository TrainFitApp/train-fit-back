const { RULE_METRICS_BY_KEY } = require("./rule-metric-catalog");

// Fase 3 Coach Pro — evaluación de una regla contra un cliente. Puro: entra
// la regla y el snapshot del cliente ya cargado, sale si se cumple y por qué.
// Sin BD, sin efectos. Los efectos (crear alerta/tarea) los aplica
// coach-rule-service.js.

// Tope de clientes que UNA regla puede afectar en una sola pasada. Es la
// válvula de seguridad de §13: una regla mal configurada ("peso > 0") daría
// positivo en toda la cartera y llenaría el panel de ruido irrecuperable.
// Al superarlo, la regla se desactiva sola y se avisa al coach con UNA
// alerta en vez de treinta.
const MAX_CLIENTS_AFFECTED_PER_RUN = 10;

// Compara el valor resuelto contra el umbral. `null` en cualquier lado
// devuelve false SIEMPRE: una regla no puede dispararse por falta de datos,
// que es el error clásico de este tipo de motor (interpretar "no sé" como
// "sí"). Y una condición sobre variación necesita changePct: si el cliente
// tiene un solo pesaje, no hay variación que juzgar.
function compare(resolved, operator, threshold) {
  if (!resolved) return false;

  const { current, changePct } = resolved;

  switch (operator) {
    case "gt":
      return current !== null && current > threshold;
    case "gte":
      return current !== null && current >= threshold;
    case "lt":
      return current !== null && current < threshold;
    case "lte":
      return current !== null && current <= threshold;

    // Los de variación trabajan sobre changePct, que es negativo al bajar.
    case "dropped_more_than_pct":
      return changePct !== null && changePct <= -Math.abs(threshold);
    case "dropped_less_than_pct":
      // "ha bajado menos de X%" incluye no haber bajado nada y haber subido:
      // es la forma en que un coach describe un estancamiento.
      return changePct !== null && changePct > -Math.abs(threshold);
    case "rose_more_than_pct":
      return changePct !== null && changePct >= Math.abs(threshold);
    case "changed_less_than_pct":
      return changePct !== null && Math.abs(changePct) < Math.abs(threshold);

    default:
      return false;
  }
}

/** Evalúa UNA condición. Devuelve el detalle para poder explicar el veredicto. */
function evaluateCondition(condition, snapshot) {
  const metric = RULE_METRICS_BY_KEY.get(condition.metric);
  if (!metric) return { met: false, metric: condition.metric, resolved: null, reason: "metrica_desconocida" };

  const resolved = metric.resolve(snapshot, condition.periodDays);
  const met = compare(resolved, condition.operator, condition.value);

  return {
    met,
    metric: condition.metric,
    label: metric.label,
    unit: metric.unit,
    resolved,
    reason: resolved ? null : "sin_datos",
  };
}

/**
 * Evalúa la regla completa contra un cliente.
 *
 * Con conditionLogic "all" basta una condición sin datos para que la regla
 * NO se dispare — deliberado: afirmar "este cliente está estancado con buena
 * adherencia" sin saber su adherencia es exactamente el diagnóstico falso
 * que el sistema debe evitar.
 */
function evaluateRule(rule, snapshot) {
  const results = rule.conditions.map((condition) => evaluateCondition(condition, snapshot));

  const met =
    rule.conditionLogic === "any"
      ? results.some((r) => r.met)
      : results.every((r) => r.met);

  return { met, conditions: results };
}

/**
 * Frase que explica POR QUÉ se disparó, con los números dentro — el mismo
 * contrato que las señales integradas: la alerta se lee sin abrir la regla.
 */
function buildEvidence(evaluation) {
  return evaluation.conditions
    .filter((c) => c.met && c.resolved)
    .map((c) => {
      const value = c.resolved.changePct !== null && c.resolved.changePct !== undefined
        ? `${c.resolved.changePct > 0 ? "+" : ""}${c.resolved.changePct.toFixed(1).replace(".", ",")}%`
        : `${Number(c.resolved.current).toFixed(1).replace(".", ",")}${c.unit ? ` ${c.unit}` : ""}`;
      return `${c.label}: ${value}`;
    })
    .join(" · ");
}

/**
 * ¿Qué clientes toca evaluar en esta pasada, según el trigger?
 *
 * El job corre igual cada noche; lo que el trigger decide es a quién mirar.
 * "after_checkin" sobre un cliente que no ha vuelto a reportar repetiría el
 * mismo veredicto sobre los mismos datos, generando una alerta idéntica que
 * la deduplicación acabaría descartando — mejor no calcularla.
 */
function shouldEvaluateClient(rule, snapshot) {
  if (rule.appliesTo === "selected") {
    const allowed = (rule.clientIds || []).map(String);
    if (!allowed.includes(String(snapshot.clientId))) return false;
  }

  if (rule.trigger === "daily") return true;

  // Sin evaluación previa, cualquier trigger corre la primera vez.
  const since = rule.lastEvaluatedAt ? new Date(rule.lastEvaluatedAt).getTime() : 0;

  if (rule.trigger === "after_checkin") {
    return !!snapshot.lastResponseAt && new Date(snapshot.lastResponseAt).getTime() > since;
  }

  if (rule.trigger === "after_measurement") {
    const last = snapshot.entries?.[snapshot.entries.length - 1];
    if (!last) return false;
    return new Date(`${last.date}T00:00:00.000Z`).getTime() > since;
  }

  return true;
}

module.exports = {
  MAX_CLIENTS_AFFECTED_PER_RUN,
  compare,
  evaluateCondition,
  evaluateRule,
  buildEvidence,
  shouldEvaluateClient,
};
