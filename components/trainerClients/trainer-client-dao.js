const mongoose = require("mongoose");
const TrainerClient = require("./trainer-client-schema");

module.exports = {
  async getBillableClientKeys(trainerId) {
    const relations = await TrainerClient.find({ trainerId,
      status: { $in: ["pending", "cuestionario_pendiente", "en_revision", "active"] },
    }).select("clientId clientEmail").lean();
    return require("../../.build/trainer-billing/usage").billableClientKeys(relations);
  },
  async create({ trainerId, clientEmail, scope }) {
    return TrainerClient.create({ trainerId, clientEmail, scope });
  },

  async findById(id) {
    return TrainerClient.findById(id);
  },

  // scope opcional: si se omite, cualquier scope activo del cliente con ese
  // trainerId satisface la comprobación (usado por notas internas, check-in, etc.).
  async findActiveByTrainerAndClient(trainerId, clientId, scope) {
    const query = { trainerId, clientId, status: "active" };
    if (scope) query.scope = scope;
    return TrainerClient.findOne(query);
  },

  // Scopes ("training"/"nutrition") que ESTE profesional tiene activos con el
  // cliente: hay una relación por scope.
  async findActiveScopes(trainerId, clientId) {
    const relations = await TrainerClient.find({ trainerId, clientId, status: "active" }).select("scope").lean();
    return [...new Set(relations.map((relation) => relation.scope).filter(Boolean))];
  },

  // ¿Existe alguna relación activa del cliente para este scope, con CUALQUIER
  // profesional? Usado por F14 para decidir si aplican las exenciones de límite.
  async hasActiveRelation(clientId, scope) {
    const query = { clientId, status: "active" };
    if (scope) query.scope = scope;
    const relation = await TrainerClient.findOne(query).select("_id").lean();
    return Boolean(relation);
  },

  // Mismos 4 estados que bloquean el índice único de trainer-client-schema.js
  // (trainerId+clientEmail+scope) — usado para avisar en el front ANTES de
  // enviar, no solo dejar que el submit falle.
  async findBlockingByTrainerAndEmail(trainerId, clientEmail) {
    return TrainerClient.find({
      trainerId,
      clientEmail: clientEmail.trim().toLowerCase(),
      status: { $in: ["pending", "cuestionario_pendiente", "en_revision", "active"] },
    }).select("scope status");
  },

  async findPendingByEmail(clientEmail) {
    return TrainerClient.find({
      clientEmail: clientEmail.trim().toLowerCase(),
      status: "pending",
    }).sort({ invitedAt: -1 });
  },

  async findActiveByClient(clientId) {
    return TrainerClient.find({ clientId, status: "active" }).sort({ respondedAt: -1 });
  },

  // Fotos de progreso: relaciones activas del cliente con el nombre del
  // profesional, para la pregunta única de compartir el historial.
  async findActiveByClientWithTrainer(clientId) {
    return TrainerClient.find({ clientId, status: "active" })
      .populate("trainerId", "name lastname email")
      .sort({ respondedAt: 1 })
      .lean();
  },

  // Todas las relaciones activas de un par (hay una por scope).
  async findActiveRelationsOfPair(trainerId, clientId) {
    return TrainerClient.find({ trainerId, clientId, status: "active" }).lean();
  },

  // Decisión 4 del plan de fotos: el cliente comparte (o deja de compartir)
  // con este profesional sus fotos anteriores a la relación. Se guarda en
  // todas las relaciones activas del par. Devuelve false si no hay ninguna.
  async setMediaHistory(trainerId, clientId, shared) {
    const now = new Date();
    const result = await TrainerClient.updateMany(
      { trainerId, clientId, status: "active" },
      { $set: { mediaHistorySharedAt: shared ? now : null, mediaHistoryAskedAt: now } }
    );
    return (result.matchedCount ?? result.n ?? 0) > 0;
  },

  async findActiveByClientAndScope(clientId, scope) {
    return TrainerClient.findOne({ clientId, scope, status: "active" });
  },

  // TASK-062 (MASTER_BACKLOG.md) — la relación "revoked" más reciente entre
  // este trainer y este cliente (cualquier scope). Se usa como corte: notas/
  // tareas creadas ANTES de ese `revokedAt` son "de una relación anterior"
  // si el cliente volvió a aceptar una invitación después.
  async findLatestRevokedForClient(trainerId, clientId) {
    return TrainerClient.findOne({ trainerId, clientId, status: "revoked" })
      .sort({ revokedAt: -1 })
      .select("revokedAt");
  },

  // Todas las relaciones (cualquier estado) de un profesional, agregables por cliente.
  async findAllByTrainer(trainerId, { status } = {}) {
    const query = { trainerId };
    if (status) query.status = Array.isArray(status) ? { $in: status } : status;
    return TrainerClient.find(query).sort({ invitedAt: -1 });
  },

  // Para listInvitesByTrainer (GET /trainer/invites) — el listado del
  // trainer necesita nombre/apellidos del cliente para las cards (no solo
  // el email), pero SOLO ese consumidor: método aparte en vez de añadir el
  // populate a findAllByTrainer para no tocar los otros 3 usos
  // (aggregateByOtherParty no lo necesita y añadir un populate ahí sería
  // trabajo de red desperdiciado en cada uno de ellos).
  async findAllByTrainerWithClient(trainerId) {
    return TrainerClient.find({ trainerId })
      .sort({ invitedAt: -1 })
      .populate("clientId", "name lastname");
  },

  // Dashboard trainer, "Requiere tu atención" — relaciones de un trainer en
  // un status concreto (p.ej. "en_revision": alta terminada por el cliente,
  // pendiente de que el trainer la confirme), con nombre/apellido/email del
  // cliente ya poblados. Mismo patrón que findAllByTrainerWithClient, con
  // filtro de status.
  async findByTrainerAndStatusWithClient(trainerId, status) {
    return TrainerClient.find({ trainerId, status })
      .sort({ respondedAt: -1 })
      .populate("clientId", "name lastname email");
  },

  // TASK-022 (MASTER_BACKLOG.md) — versión paginada de "clientes activos
  // agregados por cliente" (mismo resultado conceptual que findAllByTrainer
  // + aggregateByOtherParty en trainer-client-service.js, pero resuelto en
  // una sola agregación de Mongo: $group colapsa las N relaciones de scope
  // de un mismo cliente en un documento por cliente ANTES de paginar, para
  // que un cliente con 2 scopes no cuente como 2 filas ni quede partido
  // entre dos páginas). Ruta nueva (`/trainer/clients/paginated`), no
  // sustituye a `findAllByTrainer` — ese sigue sirviendo a los otros 3
  // consumidores de aggregateByOtherParty (profesionales, historial
  // revoked/declined) que no necesitan paginación.
  async findActiveClientsPaginated(trainerId, { page = 0, limit = 20, search = "" } = {}) {
    const skipValue = Math.max(0, page) * Math.max(1, limit);
    const limitValue = Math.max(1, limit);
    const trimmedSearch = String(search || "").trim();

    const pipeline = [
      { $match: { trainerId: new mongoose.Types.ObjectId(trainerId), status: "active" } },
      {
        $group: {
          _id: "$clientId",
          scopes: { $addToSet: "$scope" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
    ];

    if (trimmedSearch) {
      const escaped = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "i");
      pipeline.push({
        $match: {
          $or: [
            { "user.name": regex },
            { "user.lastname": regex },
            { "user.email": regex },
          ],
        },
      });
    }

    pipeline.push(
      { $sort: { "user.name": 1, "user.lastname": 1 } },
      {
        $facet: {
          data: [{ $skip: skipValue }, { $limit: limitValue }],
          totalCount: [{ $count: "count" }],
        },
      }
    );

    const [result] = await TrainerClient.aggregate(pipeline);
    const data = result?.data || [];
    const total = result?.totalCount?.[0]?.count || 0;

    return {
      clients: data.map((entry) => ({
        user: {
          _id: entry.user._id,
          name: entry.user.name,
          lastname: entry.user.lastname,
          email: entry.user.email,
        },
        scopes: entry.scopes,
      })),
      total,
    };
  },

  async findAllByClient(clientId, { status } = {}) {
    const query = { clientId };
    if (status) query.status = Array.isArray(status) ? { $in: status } : status;
    return TrainerClient.find(query).sort({ invitedAt: -1 });
  },

  // ¿Existe ya una relación ACTIVA de este scope, para este email/clientId, con
  // OTRO profesional distinto de excludingTrainerId? (regla de solapamiento, D1).
  async findOverlapping({ clientEmail, clientId, scope, excludingTrainerId }) {
    const query = {
      scope,
      status: "active",
      trainerId: { $ne: excludingTrainerId },
      $or: [{ clientEmail: clientEmail.trim().toLowerCase() }, ...(clientId ? [{ clientId }] : [])],
    };
    return TrainerClient.findOne(query);
  },

  async updateStatus(id, status, extra = {}) {
    return TrainerClient.findByIdAndUpdate(id, { $set: { status, ...extra } }, { new: true });
  },

  // Tarea 3 bis — "Objetivo de entrenamiento". `id` es siempre
  // req.trainerClientRelation._id (ya verificado por requireActiveClient
  // ("training")), nunca un id de body/query sin comprobar propiedad.
  async updateTrainingGoal(id, { trainingGoalType }) {
    return TrainerClient.findByIdAndUpdate(
      id,
      { $set: { trainingGoalType: trainingGoalType ?? null } },
      { new: true }
    );
  },

  async countByTrainer(trainerId, { status } = {}) {
    const query = { trainerId };
    if (status) query.status = Array.isArray(status) ? { $in: status } : status;
    return TrainerClient.countDocuments(query);
  },

  // "Mi cuenta" > tarjeta "Número de cambios" — clientes DISTINTOS que en
  // algún momento llegaron a "active" con este trainer (cualquier scope),
  // estén hoy vinculados o no. Cuenta también a los "revoked" a propósito:
  // es precisamente el turnover lo que se quiere reflejar. "pending"/
  // "cuestionario_pendiente"/"en_revision"/"declined" se excluyen porque esa
  // persona nunca llegó a ser realmente su cliente (revoked SIEMPRE viene
  // de haber pasado por "active" antes — ver trainer-client-schema.js).
  async countLifetimeActiveClients(trainerId) {
    const clientIds = await TrainerClient.distinct("clientId", {
      trainerId,
      status: { $in: ["active", "revoked"] },
    });
    return clientIds.length;
  },

  // TAREA 3 (coach-tab) — relaciones de un (trainerId, clientId) en cualquiera
  // de los estados dados, sin filtrar por scope. Usado por el flujo de
  // cuestionario inicial (que es UNO por par trainer-cliente, no por scope).
  async findByTrainerAndClientInStatuses(trainerId, clientId, statuses) {
    return TrainerClient.find({ trainerId, clientId, status: { $in: statuses } });
  },

  // El cliente envió el cuestionario inicial: deja de estar pendiente en
  // todas las relaciones activas del par a la vez (uno por par, no por scope).
  async clearIntakePending(trainerId, clientId) {
    return TrainerClient.updateMany(
      { trainerId, clientId, status: "active", intakePending: true },
      { $set: { intakePending: false } }
    );
  },
};
