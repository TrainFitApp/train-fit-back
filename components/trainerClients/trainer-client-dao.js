const TrainerClient = require("./trainer-client-schema");

module.exports = {
  async create(data) {
    return TrainerClient.create(data);
  },

  async findById(id) {
    return TrainerClient.findById(id);
  },

  // Funcionalidad 16 — clientes ÚNICOS (por email) con relación no-terminal
  // (cualquier scope/estado salvo revoked/declined) — el gate del tier
  // cuenta capacidad de gestión, no invitaciones sueltas ni ámbitos.
  async countActiveUniqueClients(trainerId) {
    const emails = await TrainerClient.distinct("clientEmail", {
      trainerId,
      status: { $in: TrainerClient.NON_TERMINAL_STATUSES },
    });
    return emails.length;
  },

  async findActiveByTrainerAndClient(trainerId, clientId, scope) {
    return TrainerClient.findOne({
      trainerId,
      clientId,
      scope,
      status: "active",
    }).lean();
  },

  async findOneNonTerminal(trainerId, clientEmail, scope) {
    return TrainerClient.findOne({
      trainerId,
      clientEmail,
      scope,
      status: { $in: TrainerClient.NON_TERMINAL_STATUSES },
    });
  },

  // Solo lo que aún no ha respondido el cliente. En cuanto acepta (avanza a
  // cuestionario_pendiente/en_revision), pasa a listarse en Clientes.
  async findMyInvites(trainerId) {
    return TrainerClient.find({
      trainerId,
      status: "pending",
    })
      .populate({ path: "clientId", select: "name lastname email" })
      .sort({ invitedAt: -1 })
      .lean();
  },

  // Todo lo relevante para el cliente: invitaciones sin responder (por
  // email, antes de que exista clientId) + relaciones ya aceptadas que
  // siguen su curso (por clientId) — cuestionario pendiente o esperando
  // confirmación del trainer.
  async findRelevantForClient(clientEmail, clientId) {
    return TrainerClient.find({
      $or: [
        { clientEmail, status: "pending" },
        {
          clientId,
          status: { $in: ["cuestionario_pendiente", "en_revision"] },
        },
      ],
    })
      .populate({ path: "trainerId", select: "name lastname email" })
      .sort({ invitedAt: -1 })
      .lean();
  },

  // Incluye estados aceptados por el cliente aunque el trainer no haya
  // confirmado todavía (cuestionario_pendiente/en_revision, revisión movida
  // aquí desde Invitaciones) y revoked (se muestran deshabilitados al final,
  // con opción de reactivar). El listado es por trainer, tamaño acotado, así
  // que ordenar/paginar en memoria es más simple que un aggregate con lookup.
  //
  // Un mismo (clientEmail, scope) puede tener varios documentos "revoked" en
  // BBDD (histórico de ciclos invitar→aceptar→revocar, ver
  // docs/trainfit-trainers/06-estado-actual.md) — eso NO cambia, es diseño
  // intencional. Lo que sí se evita aquí es mostrar una card por cada uno:
  // solo se lista el más relevante por (clientEmail, scope) — el estado
  // vivo si existe (pending ya no aplica aquí, pero cuestionario_pendiente/
  // en_revision/active sí), o si no hay ninguno, el revoked más reciente.
  //
  // Además, un mismo cliente puede tener a la vez relación de entrenamiento
  // Y de nutrición con el mismo trainer (dos documentos independientes, ver
  // funcionalidad 2 de 05-especificaciones-acordadas.md) — se devuelven
  // agrupadas en un único item por clientEmail (campo `relations`), no una
  // fila por ámbito.
  async findByTrainerPaginated(trainerId, { page, limit, search, scope }) {
    const query = {
      trainerId,
      status: { $in: ["cuestionario_pendiente", "en_revision", "active", "revoked"] },
    };
    if (scope) query.scope = scope;

    const all = await TrainerClient.find(query)
      .populate({ path: "clientId", select: "name lastname email" })
      .sort({ respondedAt: -1 })
      .lean();

    const latestByScopeGroup = new Map();
    for (const item of all) {
      const key = `${item.clientEmail}||${item.scope}`;
      const current = latestByScopeGroup.get(key);
      if (!current) {
        latestByScopeGroup.set(key, item);
        continue;
      }
      // Un no-terminal (cuestionario_pendiente/en_revision/active) siempre
      // gana sobre cualquier revoked histórico del mismo grupo — solo puede
      // haber uno por el índice único parcial, así que no hay ambigüedad.
      if (current.status === "revoked" && item.status !== "revoked") {
        latestByScopeGroup.set(key, item);
      } else if (current.status === "revoked" && item.status === "revoked") {
        const currentDate = new Date(current.revokedAt || current.respondedAt || current.invitedAt);
        const itemDate = new Date(item.revokedAt || item.respondedAt || item.invitedAt);
        if (itemDate > currentDate) latestByScopeGroup.set(key, item);
      }
    }
    const dedupedRelations = [...latestByScopeGroup.values()];

    const byClient = new Map();
    for (const relation of dedupedRelations) {
      const existing = byClient.get(relation.clientEmail);
      if (existing) {
        existing.relations.push(relation);
      } else {
        byClient.set(relation.clientEmail, {
          clientEmail: relation.clientEmail,
          clientId: relation.clientId,
          relations: [relation],
        });
      }
    }
    const groups = [...byClient.values()].map((group) => ({
      ...group,
      relations: group.relations.sort((a, b) => (a.scope === "training" ? -1 : 1)),
    }));

    const isAllRevoked = (group) => group.relations.every((r) => r.status === "revoked");
    const sorted = [
      ...groups.filter((group) => !isAllRevoked(group)),
      ...groups.filter((group) => isAllRevoked(group)),
    ];

    const total = sorted.length;
    const items = sorted.slice((page - 1) * limit, (page - 1) * limit + limit);

    return { items, total };
  },

  async findActiveByTrainerAndClientAnyScope(trainerId, clientId) {
    return TrainerClient.find({ trainerId, clientId, status: "active" })
      .populate({ path: "clientId", select: "name lastname email" })
      .lean();
  },

  async findPendingIntakeByTrainerAndClient(trainerId, clientId) {
    return TrainerClient.find({
      trainerId,
      clientId,
      status: "cuestionario_pendiente",
    });
  },

  async findAwaitingReviewByTrainerAndClient(trainerId, clientId) {
    return TrainerClient.find({
      trainerId,
      clientId,
      status: "en_revision",
    });
  },

  async updateStatus(id, status, extra = {}) {
    return TrainerClient.findByIdAndUpdate(
      id,
      { $set: { status, ...extra } },
      { new: true }
    );
  },

  async updateManyStatus(filter, status, extra = {}) {
    return TrainerClient.updateMany(filter, { $set: { status, ...extra } });
  },

  // --- Notas (funcionalidad 11) ---

  async addNote(relationId, note) {
    return TrainerClient.findByIdAndUpdate(
      relationId,
      { $push: { notes: note } },
      { new: true }
    );
  },

  async updateNote(relationId, noteId, updates) {
    const $set = {};
    Object.keys(updates).forEach((key) => {
      $set[`notes.$.${key}`] = updates[key];
    });
    return TrainerClient.findOneAndUpdate(
      { _id: relationId, "notes._id": noteId },
      { $set },
      { new: true }
    );
  },

  async removeNote(relationId, noteId) {
    return TrainerClient.findByIdAndUpdate(
      relationId,
      { $pull: { notes: { _id: noteId } } },
      { new: true }
    );
  },

  // --- Cobros (funcionalidad 12) ---

  async addPayment(relationId, payment) {
    return TrainerClient.findByIdAndUpdate(
      relationId,
      { $push: { payments: payment } },
      { new: true }
    );
  },

  async updatePayment(relationId, paymentId, updates) {
    const $set = {};
    Object.keys(updates).forEach((key) => {
      $set[`payments.$.${key}`] = updates[key];
    });
    return TrainerClient.findOneAndUpdate(
      { _id: relationId, "payments._id": paymentId },
      { $set },
      { new: true }
    );
  },

  async removePayment(relationId, paymentId) {
    return TrainerClient.findByIdAndUpdate(
      relationId,
      { $pull: { payments: { _id: paymentId } } },
      { new: true }
    );
  },
};
