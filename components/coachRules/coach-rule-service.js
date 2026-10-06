const coachRuleDao = require("./coach-rule-dao");
const { notFound, onDuplicate } = require("../util/http-error");
const coachAlertDao = require("../coachAlerts/coach-alert-dao");
const { planAlertWrites } = require("../coachAlerts/alert-write-plan");
const coachTaskDao = require("../coachTasks/coach-task-dao");
const {
  MAX_CLIENTS_AFFECTED_PER_RUN,
  evaluateRule,
  buildEvidence,
  shouldEvaluateClient,
} = require("./rule-evaluation-service");

// Fase 3 Coach Pro — ejecuta las reglas de un profesional sobre los
// snapshots que YA montó la evaluación de alertas (coach-alert-service.js).
// Cero consultas de carga propias: si las reglas necesitaran datos que las
// señales integradas no cargan, la evaluación pasaría de ~11 consultas por
// profesional a 11 + N por regla, y el motor de reglas se convertiría en el
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

function ruleAlertCandidate(rule, match) {
  const alertAction = rule.actions.find((a) => a.type === "create_alert");
  const taskAction = rule.actions.find((a) => a.type === "create_task");

  return {
    trainerId: rule.trainerId,
    clientId: match.clientId,
    // Las alertas de regla no se clasifican en el vocabulario cerrado de
    // las señales integradas: su tipo ES la regla, y va en ruleId.
    type: "rule_matched",
    priority: alertAction?.priority || "medium",
    reason: buildAlertReason(rule, match),
    context: {
      metric: "rule",
      ruleName: rule.name,
      evidence: match.evidence,
      level: rule.level,
      // "suggestion" propone una tarea que el coach acepta con un clic desde
      // la alerta; "automatic" ya la ha creado. La UI necesita distinguirlo.
      suggestedTaskTitle: rule.level === "suggestion" ? taskAction?.message || null : null,
    },
    ruleId: rule._id,
    dedupeKey: dedupeKeyFor(rule.trainerId, match.clientId, rule._id),
  };
}

/**
 * Freno de seguridad de §13. Una regla que da positivo en media cartera
 * está mal configurada, no ha descubierto una epidemia. Se apaga sola y se
 * avisa con UNA alerta en lugar de treinta.
 */
function runawayAlertCandidate(rule, matchCount) {
  return {
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
    dedupeKey: `${rule.trainerId}:rule-runaway:${rule._id}`,
  };
}

/**
 * Todas las reglas activas de un profesional, sobre snapshots ya cargados.
 * Primero se decide todo en memoria y luego se escribe en lote: 2 lecturas
 * y como mucho 3 tandas de escritura, tenga el profesional 1 regla o 20.
 */
async function runRulesForTrainer(trainerId, snapshots, now = new Date()) {
  const [rules, openIdByKey] = await Promise.all([
    coachRuleDao.listEnabledForTrainer(trainerId),
    coachAlertDao.listOpenIdsByKey(trainerId, { fromRules: true }),
  ]);
  const totals = { rulesRun: 0, alertsCreated: 0, tasksCreated: 0, rulesDisabled: 0, autoResolved: 0 };
  const candidates = [];
  // Solo el nivel "automatic" crea la tarea sin preguntar, y solo cuando la
  // alerta es nueva. "suggestion" la deja propuesta dentro de la alerta;
  // "informative" no propone ninguna.
  const taskByKey = new Map();
  const evaluatedRuleIds = [];
  const runaways = [];

  for (const rule of rules) {
    const matches = planRuleEffects(rule, snapshots);

    if (matches.length > MAX_CLIENTS_AFFECTED_PER_RUN) {
      runaways.push({ rule, matchCount: matches.length });
      candidates.push(runawayAlertCandidate(rule, matches.length));
      totals.rulesDisabled++;
      continue;
    }

    const taskAction = rule.actions.find((a) => a.type === "create_task");
    for (const match of matches) {
      const candidate = ruleAlertCandidate(rule, match);
      candidates.push(candidate);
      if (rule.level === "automatic" && taskAction) {
        taskByKey.set(candidate.dedupeKey, {
          title: taskAction.message,
          notes: `Creada automáticamente por la regla "${rule.name}".`,
          clientId: match.clientId,
          dueDate: null,
          sourceAlertId: null,
        });
      }
    }

    evaluatedRuleIds.push(rule._id);
    totals.rulesRun++;
  }

  // Una regla que deja de cumplirse cierra su alerta sola, igual que las
  // señales integradas (applyWritePlan). Sin esto, desactivar una regla (o
  // que un cliente deje de encajar en ella) dejaría su alerta abierta para
  // siempre.
  const plan = planAlertWrites(candidates, { openIdByKey, now });
  const [written] = await Promise.all([
    coachAlertDao.applyWritePlan(trainerId, plan, { fromRules: true }),
    ...runaways.map(({ rule, matchCount }) =>
      coachRuleDao.disableWithReason(
        rule._id,
        `Se desactivó sola: afectaba a ${matchCount} clientes en una sola pasada (máximo ${MAX_CLIENTS_AFFECTED_PER_RUN}).`
      )
    ),
  ]);

  // Después de escribir las alertas, no a la vez: si aquello falla, ni hay
  // tareas huérfanas ni las reglas quedan marcadas como evaluadas (los
  // triggers "after_*" volverán a mirar los mismos datos).
  const insertedKeys = new Set(plan.inserts.map((alert) => alert.dedupeKey));
  const tasks = [...taskByKey].filter(([key]) => insertedKeys.has(key)).map(([, task]) => task);
  await Promise.all([
    tasks.length ? coachTaskDao.createMany(trainerId, tasks) : null,
    evaluatedRuleIds.length ? coachRuleDao.markEvaluated(evaluatedRuleIds, now) : null,
  ]);

  // El aviso de regla desbocada no cuenta como alerta creada, igual que antes.
  totals.alertsCreated = plan.inserts.filter((alert) => !alert.context?.runaway).length;
  totals.tasksCreated = tasks.length;
  totals.autoResolved = written.autoResolved;

  return totals;
}

const duplicateName = onDuplicate("Ya tienes una regla con ese nombre");
const ruleNotFound = () => notFound("Regla no encontrada");

module.exports = {
  runRulesForTrainer,
  // Biblioteca de reglas del profesional (siempre filtradas por él).
  listForTrainer: (trainerId) => coachRuleDao.listForTrainer(trainerId),
  create: (trainerId, data) => coachRuleDao.create(trainerId, data).catch(duplicateName),
  async update(trainerId, id, updates) {
    const rule = await coachRuleDao.update(trainerId, id, updates).catch(duplicateName);
    if (!rule) throw ruleNotFound();
    return rule;
  },
  async remove(trainerId, id) {
    if (!(await coachRuleDao.remove(trainerId, id))) throw ruleNotFound();
  },
  // Exportadas para test unitario (puras).
  planRuleEffects,
  buildAlertReason,
  dedupeKeyFor,
};
