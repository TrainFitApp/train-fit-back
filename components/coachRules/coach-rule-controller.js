const coachRuleService = require("./coach-rule-service");
const trainerClientService = require("../trainerClients/trainer-client-service");
const { toCatalogDto, RULE_METRICS_BY_KEY, OPERATORS_BY_KIND } = require("./rule-metric-catalog");

const LEVELS = ["informative", "suggestion", "automatic"];
const TRIGGERS = ["daily", "after_checkin", "after_measurement"];

// Validación que el schema no puede hacer: que el operador tenga sentido
// PARA ESA métrica. Mongoose valida cada campo por separado (métrica
// conocida, operador conocido), pero no la combinación — y "el nivel de
// estrés ha bajado un 5%" pasa las dos validaciones sueltas siendo una
// pregunta sin significado.
function validateConditions(conditions) {
  if (!Array.isArray(conditions) || !conditions.length) {
    return "Una regla necesita al menos una condición";
  }
  for (const condition of conditions) {
    const metric = RULE_METRICS_BY_KEY.get(condition.metric);
    if (!metric) return `Métrica no reconocida: ${condition.metric}`;

    const allowed = OPERATORS_BY_KIND[metric.kind] || [];
    if (!allowed.includes(condition.operator)) {
      return `El operador "${condition.operator}" no aplica a ${metric.label}`;
    }
    if (typeof condition.value !== "number" || !Number.isFinite(condition.value)) {
      return `La condición sobre ${metric.label} necesita un valor numérico`;
    }
  }
  return null;
}

function validateActions(actions) {
  if (!Array.isArray(actions) || !actions.length) {
    return "Una regla necesita al menos una acción";
  }
  // Toda regla crea una alerta: sin ella, la regla actuaría en silencio y el
  // coach no tendría dónde ver que se disparó. "Crear tarea" es un extra
  // sobre la alerta, nunca un sustituto.
  if (!actions.some((a) => a.type === "create_alert")) {
    return "Una regla siempre tiene que crear una alerta, para que quede constancia de que se disparó";
  }
  for (const action of actions) {
    if (!action.message || !String(action.message).trim()) {
      return "Cada acción necesita un texto";
    }
  }
  return null;
}

// Un clientId en el body no pasa por requireActiveClient (esta ruta no lleva
// :clientId), así que la relación se comprueba aquí — igual que en
// coach-task-controller.js#resolveClientId.
async function validateClientIds(trainerId, clientIds) {
  for (const clientId of clientIds || []) {
    const block = await trainerClientService.clientWriteBlock(trainerId, clientId);
    if (block === "no_relation") return "Alguno de los clientes seleccionados no tiene una relación activa contigo";
    if (block === "read_only") return "Alguno de los clientes seleccionados está en solo lectura por el cupo de tu plan";
  }
  return null;
}

function buildPayload(body) {
  return {
    name: String(body.name || "").trim(),
    description: String(body.description || "").trim(),
    enabled: body.enabled !== false,
    level: LEVELS.includes(body.level) ? body.level : "informative",
    trigger: TRIGGERS.includes(body.trigger) ? body.trigger : "daily",
    conditions: body.conditions,
    conditionLogic: body.conditionLogic === "any" ? "any" : "all",
    actions: body.actions,
    appliesTo: body.appliesTo === "selected" ? "selected" : "all_clients",
    clientIds: body.appliesTo === "selected" ? body.clientIds || [] : [],
    // Reactivar a mano limpia el motivo de la desactivación automática: si
    // no, la regla volvería a funcionar arrastrando un cartel de "se
    // desactivó sola" que ya no es cierto.
    disabledReason: body.enabled !== false ? null : undefined,
  };
}

module.exports = {
  // GET /trainer/rules/catalog — el vocabulario que pinta el constructor
  // visual. Se sirve desde el backend para que sea imposible que la UI
  // ofrezca una métrica u operador que el evaluador no sabe resolver.
  async getCatalog(req, res) {
    return res.send(toCatalogDto());
  },

  async listMine(req, res) {
    const rules = await coachRuleService.listForTrainer(req.auth.userId);
    return res.send(rules);
  },

  async create(req, res) {
    const body = req.body || {};
    if (!body.name || !String(body.name).trim()) {
      return res.status(400).send({ message: "La regla necesita un nombre" });
    }

    const conditionError = validateConditions(body.conditions);
    if (conditionError) return res.status(400).send({ message: conditionError });

    const actionError = validateActions(body.actions);
    if (actionError) return res.status(400).send({ message: actionError });

    const clientError = await validateClientIds(req.auth.userId, body.clientIds);
    if (clientError) return res.status(403).send({ message: clientError });

    return res.status(201).send(await coachRuleService.create(req.auth.userId, buildPayload(body)));
  },

  async update(req, res) {
    const body = req.body || {};

    if (body.conditions !== undefined) {
      const conditionError = validateConditions(body.conditions);
      if (conditionError) return res.status(400).send({ message: conditionError });
    }
    if (body.actions !== undefined) {
      const actionError = validateActions(body.actions);
      if (actionError) return res.status(400).send({ message: actionError });
    }
    const clientError = await validateClientIds(req.auth.userId, body.clientIds);
    if (clientError) return res.status(403).send({ message: clientError });

    return res.send(await coachRuleService.update(req.auth.userId, req.params.id, buildPayload(body)));
  },

  // PATCH /trainer/rules/:id/toggle — activar/desactivar sin abrir el editor.
  async toggle(req, res) {
    const enabled = req.body?.enabled !== false;
    const rule = await coachRuleService.update(req.auth.userId, req.params.id, {
      enabled,
      disabledReason: enabled ? null : undefined,
    });
    return res.send(rule);
  },

  async remove(req, res) {
    await coachRuleService.remove(req.auth.userId, req.params.id);
    return res.sendStatus(204);
  },
};
