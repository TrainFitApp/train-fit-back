const mongoose = require("mongoose");
const CoachAlert = require("./coach-alert-schema");

// Orden de gravedad para ordenar en Mongo. `priority` se guarda como string
// (legible en la BD y en la API); el orden alfabético de "high"/"medium"/
// "low" no coincide con el de gravedad, así que se proyecta a número en la
// propia consulta en vez de reordenar en Node después de paginar.
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

module.exports = {
  // Alertas abiertas por cliente de la cartera ({ total, high }): un recuento
  // en Mongo, sin traer los documentos.
  async countOpenByClient(trainerId) {
    const rows = await CoachAlert.aggregate([
      { $match: { trainerId: new mongoose.Types.ObjectId(String(trainerId)), status: "open" } },
      {
        $group: {
          _id: "$clientId",
          total: { $sum: 1 },
          high: { $sum: { $cond: [{ $eq: ["$priority", "high"] }, 1, 0] } },
        },
      },
    ]);
    return new Map(rows.map((row) => [String(row._id), { total: row.total, high: row.high }]));
  },

  // Abiertas del profesional en UN ámbito, como dedupeKey -> _id: lo que
  // planAlertWrites necesita para decidir entre insertar y refrescar. Una
  // consulta por evaluación en vez de una por alerta candidata.
  //   fromRules false: señales del sistema (ruleId null).
  //   fromRules true:  alertas de regla, incluida la de regla desbocada.
  // Van por separado porque las dos pasadas son independientes: si la de
  // reglas falla, sus alertas deben quedarse como están.
  async listOpenIdsByKey(trainerId, { fromRules }) {
    const rows = await CoachAlert.find({ trainerId, status: "open", ruleId: ruleScope(fromRules) })
      .select("dedupeKey")
      .lean();
    return new Map(rows.map((row) => [row.dedupeKey, row._id]));
  },

  // Claves cerradas A MANO desde `since` — el servicio no las reabre durante
  // el periodo de silencio (coach-alert-service.js#ALERT_COOLDOWN_DAYS).
  //
  // Solo cuentan los cierres humanos: `dismissed` (siempre manual) o
  // `resolved` con resolvedBy. Los cierres AUTOMÁTICOS (resolvedBy null)
  // quedan fuera a propósito — si contaran, un cliente que responde su
  // check-in cerraría la alerta automáticamente y eso silenciaría la de la
  // siguiente durante dos semanas, justo el caso que la alerta existe para
  // detectar.
  async listManuallyClosedKeysSince(trainerId, since) {
    const keys = await CoachAlert.distinct("dedupeKey", {
      trainerId,
      resolvedAt: { $gte: since },
      $or: [{ status: "dismissed" }, { status: "resolved", resolvedBy: { $ne: null } }],
    });
    return new Set(keys);
  },

  /**
   * Aplica un plan de alert-write-plan.js: inserta las nuevas, refresca las
   * que siguen vigentes (frase y números sí, createdAt NO: el coach necesita
   * ver que el problema lleva 3 semanas ahí) y cierra solas las del mismo
   * ámbito que ya no salen.
   *
   * El cierre automático va sin nota ni autor: nadie hizo nada explícito, el
   * problema desapareció solo (el cliente respondió, el coach confirmó el
   * cuestionario...). Corre en paralelo con el bulkWrite: su $nin excluye
   * todo lo que este inserta o refresca, así que no pueden pisarse.
   *
   * Un E11000 solo puede venir de otra evaluación del mismo profesional en
   * otro proceso que insertó la misma alerta un instante antes: el índice
   * único parcial ya garantiza lo que se quería, así que no es un error.
   */
  async applyWritePlan(trainerId, plan, { fromRules }) {
    const ops = [
      ...plan.inserts.map((document) => ({ insertOne: { document } })),
      ...plan.refreshes.map(({ _id, set }) => ({ updateOne: { filter: { _id }, update: { $set: set } } })),
    ];

    const [written, resolved] = await Promise.all([
      ops.length ? bulkWriteIgnoringDuplicates(ops) : null,
      CoachAlert.updateMany(
        {
          trainerId,
          status: "open",
          ruleId: ruleScope(fromRules),
          dedupeKey: { $nin: plan.keptKeys },
        },
        { $set: { status: "resolved", resolvedAt: new Date(), resolvedBy: null } }
      ),
    ]);

    return {
      created: written?.insertedCount || 0,
      refreshed: plan.refreshes.length,
      autoResolved: resolved?.modifiedCount || 0,
    };
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
};

// --- helpers privados ---

function ruleScope(fromRules) {
  return fromRules ? { $ne: null } : null;
}

async function bulkWriteIgnoringDuplicates(ops) {
  try {
    return await CoachAlert.bulkWrite(ops, { ordered: false });
  } catch (error) {
    const writeErrors = [].concat(error.writeErrors || []);
    if (!writeErrors.length || writeErrors.some((e) => e.code !== 11000)) throw error;
    return error.result;
  }
}

function toObjectId(value) {
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value);
}

function priorityBranches() {
  return Object.entries(PRIORITY_RANK).map(([priority, rank]) => ({
    case: { $eq: ["$priority", priority] },
    then: rank,
  }));
}
