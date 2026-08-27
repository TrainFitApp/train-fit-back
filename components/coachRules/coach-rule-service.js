const coachRuleDao = require("./coach-rule-dao");
const coachAlertDao = require("../coachAlerts/coach-alert-dao");
const coachTaskDao = require("../coachTasks/coach-task-dao");
const {
  MAX_CLIENTS_AFFECTED_PER_RUN,
  evaluateRule,
  buildEvidence,
  shouldEvaluateClient,
} = require("./rule-evaluation-service");

// Fase 3 Coach Pro — ejecuta las reglas de un profesional sobre los
// snapshots que YA montó el evaluador nocturno (coach-alert-service.js).
// Cero consultas de carga propias: si las reglas necesitaran datos que las
// señales integradas no cargan, el job pasaría de ~7 consultas por
// profesional a 7 + N por regla, y el motor de reglas se convertiría en el
// cuello de botella del sistema. El catálogo de métricas está acotado
// justamente a lo que el snapshot ya trae (ver rule-metric-catalog.js).

function dedupeKeyFor(trainerId, clientId, ruleId) {
  // A diferencia de las señales integradas (que se identifican por tipo),
  // una alerta de regla se identifica por LA REGLA: dos reglas distintas
  // sobre el mismo cliente son dos problemas distintos, y la misma regla
  // dos noches seguidas es el mismo.
  return `${trainerId}:${clientId}:rule:${ruleId}`;
}

/**
 * Ejecuta UNA regla sobre los snapshots de sus clientes.
 *
 * Devuelve los efectos a aplicar en vez de aplicarlos, para poder contar
 * cuántos clientes afecta ANTES de escribir nada: si supera el tope, no se
 * escribe ninguno. Comprobar el tope sobre la marcha dejaría las primeras
 * diez escrituras hechas y las demás no, que es el peor resultado posible.
 */
function planRuleEffects(rule, snapshots) {
  const matches = [];

  for (const snapshot of snapshots) {
    if (snapshot.relationStatus !== "active") continue;
    if (!shouldEvaluateClient(rule, snapshot)) continue;

    const evaluation = evaluateRule(rule, snapshot);
    if (!evaluation.met) continue;

    matches.push({
      clientId: snapshot.clientId,
      clientName: snapshot.clientName,
      shortName: snapshot.shortName,
      evidence: buildEvidence(evaluation),
    });
  }

  return matches;
}

/**
 * Frase final de la alerta: lo que el coach escribió en la regla, más los
 * números que la dispararon. Sin la evidencia, dos clientes con la misma
 * regla darían alertas idénticas e inútiles ("Posible estancamiento") sin
 * decir en qué se basa.
 */
function buildAlertReason(rule, match) {
  const action = rule.actions.find((a) => a.type === "create_alert");
  const base = `${match.shortName}: ${action?.message || rule.name}`;
  return match.evidence ? `${base} (${match.evidence})` : base;
}

async function applyRuleEffects(rule, matches, now) {
  let alertsCreated = 0;
  let tasksCreated = 0;

  const alertAction = rule.actions.find((a) => a.type === "create_alert");
  const taskAction = rule.actions.find((a) => a.type === "create_task");

  for (const match of matches) {
    const dedupeKey = dedupeKeyFor(rule.trainerId, match.clientId, rule._id);
    const existing = await coachAlertDao.findOpenByDedupeKey(dedupeKey);

    const reason = buildAlertReason(rule, match);
    const context = {
      metric: "rule",
      ruleName: rule.name,
      evidence: match.evidence,
      level: rule.level,
      // "suggestion" propone una tarea que el coach acepta con un clic desde
      // la alerta; "automatic" ya la ha creado. La UI necesita distinguirlo.
      suggestedTaskTitle: rule.level === "suggestion" ? taskAction?.message || null : null,
    };

    if (existing) {
      await coachAlertDao.refresh(existing._id, {
        reason,
        context,
        priority: alertAction?.priority || "medium",
        lastSeenAt: now,
      });
      continue;
    }

    await coachAlertDao.create({
      trainerId: rule.trainerId,
      clientId: match.clientId,
      // Las alertas de regla no se clasifican en el vocabulario cerrado de
      // las señales integradas: su tipo ES la regla, y va en ruleId.
      type: "rule_matched",
      priority: alertAction?.priority || "medium",
      reason,
      context,
      ruleId: rule._id,
      dedupeKey,
      lastSeenAt: now,
      createdAt: now,
    });
    alertsCreated++;

    // Solo el nivel "automatic" crea la tarea sin preguntar. "suggestion" la
    // deja propuesta dentro de la alerta; "informative" no propone ninguna.
    if (rule.level === "automatic" && taskAction) {
      await coachTaskDao.create(rule.trainerId, {
        title: taskAction.message,
        notes: `Creada automáticamente por la regla "${rule.name}".`,
        clientId: match.clientId,
        dueDate: null,
        sourceAlertId: null,
      });
      tasksCreated++;
    }
  }

  return { alertsCreated, tasksCreated };
}

/**
 * Freno de seguridad de §13. Una regla que da positivo en media cartera
 * está mal configurada, no ha descubierto una epidemia. Se apaga sola y se
 * avisa con UNA alerta en lugar de treinta.
 */
async function reportRunaway(rule, matchCount, now) {
  await coachRuleDao.disableWithReason(
    rule._id,
    `Se desactivó sola: afectaba a ${matchCount} clientes en una sola pasada (máximo ${MAX_CLIENTS_AFFECTED_PER_RUN}).`
  );

  const dedupeKey = `${rule.trainerId}:rule-runaway:${rule._id}`;
  const existing = await coachAlertDao.findOpenByDedupeKey(dedupeKey);
  if (existing) return;

  await coachAlertDao.create({
    trainerId: rule.trainerId,
    // La alerta es sobre la regla, no sobre un cliente. clientId es
    // obligatorio en el modelo, así que se usa el primero afectado como
    // ancla — el texto deja claro que el problema es la regla.
    clientId: rule.clientIds?.[0] || rule.trainerId,
    type: "rule_matched",
    priority: "high",
    reason: `La regla "${rule.name}" se ha desactivado sola: daba positivo en ${matchCount} clientes a la vez. Revísala antes de volver a activarla.`,
    context: { metric: "rule", ruleName: rule.name, matchCount, runaway: true },
    ruleId: rule._id,
    dedupeKey,
    lastSeenAt: now,
    createdAt: now,
  });
}

/** Todas las reglas activas de un profesional, sobre snapshots ya cargados. */
async function runRulesForTrainer(trainerId, snapshots, now = new Date()) {
  const rules = await coachRuleDao.listEnabledForTrainer(trainerId);
  const totals = { rulesRun: 0, alertsCreated: 0, tasksCreated: 0, rulesDisabled: 0, autoResolved: 0 };
  const stillOpenKeys = [];

  for (const rule of rules) {
    const matches = planRuleEffects(rule, snapshots);

    if (matches.length > MAX_CLIENTS_AFFECTED_PER_RUN) {
      await reportRunaway(rule, matches.length, now);
      stillOpenKeys.push(`${rule.trainerId}:rule-runaway:${rule._id}`);
      totals.rulesDisabled++;
      continue;
    }

    if (matches.length) {
      const applied = await applyRuleEffects(rule, matches, now);
      totals.alertsCreated += applied.alertsCreated;
      totals.tasksCreated += applied.tasksCreated;
      matches.forEach((m) => stillOpenKeys.push(dedupeKeyFor(rule.trainerId, m.clientId, rule._id)));
    }

    await coachRuleDao.markEvaluated(rule._id, now);
    totals.rulesRun++;
  }

  // Una regla que deja de cumplirse cierra su alerta sola, igual que las
  // señales integradas. Sin esto, desactivar una regla (o que un cliente
  // deje de encajar en ella) dejaría su alerta abierta para siempre.
  const resolved = await coachAlertDao.autoResolveMissingRuleAlerts(trainerId, stillOpenKeys);
  totals.autoResolved = resolved?.modifiedCount || 0;

  return totals;
}

module.exports = {
  runRulesForTrainer,
  // Exportadas para test unitario (puras).
  planRuleEffects,
  buildAlertReason,
  dedupeKeyFor,
};
