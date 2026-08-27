const mongoose = require("mongoose");
const CoachAlert = require("./coach-alert-schema");

// Orden de gravedad para ordenar en Mongo. `priority` se guarda como string
// (legible en la BD y en la API); el orden alfabético de "high"/"medium"/
// "low" no coincide con el de gravedad, así que se proyecta a número en la
// propia consulta en vez de reordenar en Node después de paginar.
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

module.exports = {
  async findOpenByDedupeKey(dedupeKey) {
    return CoachAlert.findOne({ dedupeKey, status: "open" }).lean();
  },

  // El cierre MANUAL más reciente de este mismo problema — el servicio lo
  // usa para no reabrir algo que el coach acaba de cerrar a mano (periodo de
  // silencio, ver coach-alert-service.js#ALERT_COOLDOWN_DAYS).
  //
  // Solo cuentan los cierres humanos: `dismissed` (siempre manual) o
  // `resolved` con resolvedBy. Los cierres AUTOMÁTICOS (autoResolveMissing,
  // resolvedBy null) quedan fuera a propósito — si contaran, un cliente que
  // responde su check-in cerraría la alerta automáticamente y eso silenciaría
  // la del ciclo siguiente durante dos semanas, justo el caso que la alerta
  // existe para detectar.
  async findLastManuallyClosedByDedupeKey(dedupeKey) {
    return CoachAlert.findOne({
      dedupeKey,
      $or: [{ status: "dismissed" }, { status: "resolved", resolvedBy: { $ne: null } }],
    })
      .sort({ resolvedAt: -1 })
      .select("resolvedAt")
      .lean();
  },

  async create(alert) {
    return CoachAlert.create(alert);
  },

  // Refresca una alerta abierta que sigue vigente: los números y la frase se
  // actualizan (el estancamiento pasa de 3 a 4 semanas), createdAt NO — es
  // la fecha en que apareció el problema, y el coach necesita ver que lleva
  // 3 semanas ahí.
  async refresh(id, { reason, context, priority, lastSeenAt }) {
    return CoachAlert.findByIdAndUpdate(
      id,
      { $set: { reason, context, priority, lastSeenAt } },
      { new: true }
    ).lean();
  },

  async listForTrainer(trainerId, { status = "open", limit = 100 } = {}) {
    return CoachAlert.aggregate([
      { $match: { trainerId: toObjectId(trainerId), status } },
      { $addFields: { priorityRank: { $switch: { branches: priorityBranches(), default: 3 } } } },
      { $sort: { priorityRank: 1, createdAt: -1 } },
      { $limit: limit },
      {
        $lookup: {
          from: "users",
          localField: "clientId",
          foreignField: "_id",
          as: "client",
        },
      },
      { $unwind: { path: "$client", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          type: 1,
          priority: 1,
          reason: 1,
          context: 1,
          status: 1,
          coachNote: 1,
          ruleId: 1,
          lastSeenAt: 1,
          createdAt: 1,
          resolvedAt: 1,
          clientId: 1,
          "client.name": 1,
          "client.lastname": 1,
        },
      },
    ]);
  },

  // Alertas de UN cliente, para la pestaña Resumen de su ficha (Fase 2).
  // Sin $lookup del usuario, a diferencia de listForTrainer: aquí el cliente
  // ya lo conoce quien pregunta — es el de la URL.
  async listForClient(trainerId, clientId, { status, limit = 50 } = {}) {
    const filter = { trainerId, clientId };
    if (status) filter.status = status;
    return CoachAlert.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  },

  // trainerId en el filtro, no solo el _id: impide cerrar la alerta de otro
  // coach conociendo su id (mismo criterio que el resto de DAOs del módulo
  // trainer — ver trainer-note-dao, checkin-dao#updateDefinition).
  async setStatus(trainerId, id, { status, coachNote, resolvedBy }) {
    return CoachAlert.findOneAndUpdate(
      { _id: id, trainerId },
      {
        $set: {
          status,
          coachNote: coachNote || "",
          resolvedAt: status === "open" ? null : new Date(),
          resolvedBy: status === "open" ? null : resolvedBy,
        },
      },
      { new: true }
    ).lean();
  },

  // Cierre automático: la condición ya no se cumple (el coach confirmó el
  // cuestionario, el cliente respondió el check-in...). Se marcan como
  // "resolved" sin nota — nadie hizo nada explícito, el problema
  // desapareció solo. Sin esto, una alerta de check-in seguiría abierta
  // eternamente después de que el cliente respondiera.
  async autoResolveMissing(trainerId, stillOpenDedupeKeys) {
    return CoachAlert.updateMany(
      { trainerId, status: "open", ruleId: null, dedupeKey: { $nin: stillOpenDedupeKeys } },
      { $set: { status: "resolved", resolvedAt: new Date(), resolvedBy: null } }
    );
  },

  // Fase 3 — el mismo cierre automático para las alertas DE REGLA, que
  // autoResolveMissing excluye a propósito (`ruleId: null`). Van por
  // separado porque las dos pasadas son independientes: si la evaluación de
  // reglas falla, las alertas de regla deben quedarse como están en vez de
  // cerrarse todas por no aparecer en una lista que nunca se completó.
  async autoResolveMissingRuleAlerts(trainerId, stillOpenDedupeKeys) {
    return CoachAlert.updateMany(
      {
        trainerId,
        status: "open",
        ruleId: { $ne: null },
        dedupeKey: { $nin: stillOpenDedupeKeys },
      },
      { $set: { status: "resolved", resolvedAt: new Date(), resolvedBy: null } }
    );
  },
};

// --- helpers privados ---

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value);
}

function priorityBranches() {
  return Object.entries(PRIORITY_RANK).map(([priority, rank]) => ({
    case: { $eq: ["$priority", priority] },
    then: rank,
  }));
}
