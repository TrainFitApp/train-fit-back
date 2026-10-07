const mongoose = require("mongoose");
const TrainerClient = require("./trainer-client-schema");
const { OPEN_STATUSES, activeScopes, findLink, invitationView } = require("./pair-state");

// Único punto de acceso a TrainerClient (un documento por par profesional ↔
// cliente): es la puerta de los permisos del módulo profesional.

const activeLink = (scope = null) => ({ $elemMatch: scope ? { scope, status: "active" } : { status: "active" } });
const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const ids = (docs, field) => new Set(docs.map((doc) => String(doc[field])));
const validIds = (...values) => values.every((value) => mongoose.isValidObjectId(value));

// Lee el par de una invitación y la devuelve en plano; null si no existe.
async function invitationById(invitationId) {
  if (!validIds(invitationId)) return null;
  const pair = await TrainerClient.findOne({ "scopes._id": invitationId }).lean();
  const link = findLink(pair, invitationId);
  return link ? { pair, invitation: invitationView(pair, link) } : null;
}

// Cambia el estado de una invitación solo si sigue en `from` (atómico).
async function moveInvitation(filter, invitationId, from, set) {
  const updates = Object.fromEntries(Object.entries(set).map(([key, value]) => [`scopes.$.${key}`, value]));
  const pair = await TrainerClient.findOneAndUpdate(
    { ...filter, scopes: { $elemMatch: { _id: invitationId, status: { $in: from } } } },
    { $set: updates },
    { new: true }
  ).lean();
  return pair ? { pair, invitation: invitationView(pair, findLink(pair, invitationId)) } : null;
}

// Responde en una sola escritura (atómica) las invitaciones `linkIds` del
// par que sigan pendientes; `pairFields` va al par. null si no quedaba
// ninguna pendiente.
async function answerInvitations(pairId, linkIds, linkFields, pairFields = {}) {
  const updates = Object.fromEntries(Object.entries(linkFields).map(([key, value]) => [`scopes.$[link].${key}`, value]));
  const pending = { _id: { $in: linkIds }, status: "pending" };
  return TrainerClient.findOneAndUpdate(
    { _id: pairId, scopes: { $elemMatch: pending } },
    { $set: { ...pairFields, ...updates } },
    { new: true, arrayFilters: [{ "link._id": pending._id, "link.status": "pending" }] }
  ).lean();
}

// Pone `item` en la lista `field` del par, sustituyendo el que tenga el mismo
// `key` (una entrada por zona o por ejercicio). Sin el par, null.
async function putInList(trainerId, clientId, field, key, item) {
  if (!validIds(trainerId, clientId)) return null;
  const base = { trainerId, clientId };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const replaced = await TrainerClient.updateOne(
      { ...base, [`${field}.${key}`]: item[key] },
      { $set: { [`${field}.$`]: item } },
      { runValidators: true }
    );
    if (replaced.matchedCount) return item;
    // `$ne` en el filtro: si otra petición acaba de añadir la misma clave, no
    // se duplica y la segunda vuelta la sustituye.
    const added = await TrainerClient.updateOne(
      { ...base, [`${field}.${key}`]: { $ne: item[key] } },
      { $push: { [field]: item } },
      { runValidators: true }
    );
    if (added.matchedCount) return item;
    if (!(await TrainerClient.exists(base))) return null;
  }
  return item;
}

module.exports = {
  // --- Un par ----------------------------------------------------------------

  async findPair(trainerId, clientId) {
    if (!validIds(trainerId, clientId)) return null;
    return TrainerClient.findOne({ trainerId, clientId }).lean();
  },

  async findPairByEmail(trainerId, clientEmail) {
    if (!validIds(trainerId)) return null;
    return TrainerClient.findOne({ trainerId, clientEmail: normalizeEmail(clientEmail) }).lean();
  },

  // El par si tiene algún scope activo (de `scope`, si se pasa); si no, null.
  async findActivePair(trainerId, clientId, scope = null) {
    if (!validIds(trainerId, clientId)) return null;
    return TrainerClient.findOne({ trainerId, clientId, scopes: activeLink(scope) }).lean();
  },

  async isActivePair(trainerId, clientId, scope = null) {
    if (!validIds(trainerId, clientId)) return false;
    return Boolean(await TrainerClient.exists({ trainerId, clientId, scopes: activeLink(scope) }));
  },

  async findActiveScopes(trainerId, clientId) {
    return activeScopes(await this.findActivePair(trainerId, clientId));
  },

  // --- Por cliente -------------------------------------------------------------

  // ¿Tiene el cliente algún profesional activo (de ese scope)? Exenciones de
  // límites del plan gratuito y permisos de subida de vídeos.
  async hasActiveTrainer(clientId, scope = null) {
    return Boolean(await TrainerClient.exists({ clientId, scopes: activeLink(scope) }));
  },

  async findActiveTrainerIds(clientId, scope = null) {
    return ids(await TrainerClient.find({ clientId, scopes: activeLink(scope) }).select("trainerId").lean(), "trainerId");
  },

  // Pares en curso del cliente; con `withTrainer`, trainerId poblado con su nombre.
  async findActivePairsOfClient(clientId, { withTrainer = false } = {}) {
    const query = TrainerClient.find({ clientId, scopes: activeLink() }).sort({ createdAt: 1 });
    if (withTrainer) query.populate("trainerId", "name lastname email");
    return query.lean();
  },

  // Invitaciones sin responder de un email, con el profesional poblado.
  async findPairsWithPendingInvitations(clientEmail) {
    return TrainerClient.find({ clientEmail: normalizeEmail(clientEmail), "scopes.status": "pending" })
      .populate("trainerId", "name lastname email")
      .lean();
  },

  // Pares del cliente con relaciones terminadas (historial), con el profesional poblado.
  async findPairsWithClosedLinksOfClient(clientId, clientEmail) {
    return TrainerClient.find({
      $or: [{ clientId }, { clientEmail: normalizeEmail(clientEmail) }],
      "scopes.status": { $in: ["declined", "revoked"] },
    })
      .populate("trainerId", "name lastname email")
      .lean();
  },

  // ¿Lleva OTRO profesional este scope del cliente? Un cliente tiene como
  // mucho un profesional activo por scope.
  async hasOtherActiveTrainer({ clientEmail, clientId, scope, excludingTrainerId }) {
    return Boolean(
      await TrainerClient.exists({
        trainerId: { $ne: excludingTrainerId },
        $or: [{ clientEmail: normalizeEmail(clientEmail) }, ...(clientId ? [{ clientId }] : [])],
        scopes: activeLink(scope),
      })
    );
  },

  // --- Por profesional --------------------------------------------------------

  // Todos sus pares (invitaciones e historial), con el cliente poblado.
  async findPairsOfTrainer(trainerId) {
    return TrainerClient.find({ trainerId }).populate("clientId", "name lastname email").lean();
  },

  // Pares en curso; con `withClient`, clientId poblado con lo que pintan
  // las listas y la evaluación de alertas.
  async findActivePairsOfTrainer(trainerId, { withClient = false } = {}) {
    const query = TrainerClient.find({ trainerId, clientId: { $exists: true }, scopes: activeLink() });
    if (withClient) query.populate("clientId", "name lastname email timezone");
    return query.lean();
  },

  // Ids (string) de sus clientes con algún scope activo (de `scope`), solo
  // entre `clientIds` si se pasa.
  async findActiveClientIds(trainerId, { clientIds = null, scope = null } = {}) {
    const query = { trainerId, scopes: activeLink(scope), clientId: clientIds ? { $in: clientIds } : { $exists: true } };
    return ids(await TrainerClient.find(query).select("clientId").lean(), "clientId");
  },

  // Pares que llegaron a ser clientes (relación en curso o terminada).
  async findClientPairsOfTrainer(trainerId) {
    return TrainerClient.find({ trainerId, clientId: { $exists: true } }).select("clientId scopes").lean();
  },

  // Clientes distintos que alguna vez estuvieron activos (sigan o no).
  async countLifetimeClients(trainerId) {
    return TrainerClient.countDocuments({ trainerId, "scopes.status": { $in: ["active", "revoked"] } });
  },

  // --- Plazas -------------------------------------------------------------------

  // Pares que reservan u ocupan plaza (alguna invitación abierta): una
  // persona es una plaza aunque tenga los dos scopes.
  async findSeatPairs(trainerId) {
    return TrainerClient.find({ trainerId, "scopes.status": { $in: OPEN_STATUSES } })
      .select("clientId clientEmail scopes")
      .lean();
  },

  async countSeats(trainerId) {
    const [open, occupied] = await Promise.all([
      TrainerClient.countDocuments({ trainerId, "scopes.status": { $in: OPEN_STATUSES } }),
      TrainerClient.countDocuments({ trainerId, "scopes.status": "active" }),
    ]);
    return { occupied, reserved: open - occupied };
  },

  // --- Invitaciones ---------------------------------------------------------------

  findInvitation: invitationById,

  // Crea el par si no existe y le añade la invitación pendiente del scope.
  // Atómico: si el par ya tiene ese scope abierto, el upsert choca con el
  // índice único (trainerId, clientEmail) y lanza E11000 (duplicada).
  async createInvitation(trainerId, clientEmail, scope) {
    const link = { _id: new mongoose.Types.ObjectId(), scope, status: "pending", invitedAt: new Date() };
    await TrainerClient.updateOne(
      {
        trainerId,
        clientEmail: normalizeEmail(clientEmail),
        scopes: { $not: { $elemMatch: { scope, status: { $in: OPEN_STATUSES } } } },
      },
      { $push: { scopes: link } },
      { upsert: true }
    );
    return invitationById(link._id);
  },

  // Copia al par el formulario de alta que se le pide al cliente
  // (TrainerClient.intakeForm).
  async setIntakeForm(trainerId, clientEmail, form) {
    await TrainerClient.updateOne(
      { trainerId, clientEmail: normalizeEmail(clientEmail) },
      { $set: { intakeForm: { ...form, sentAt: new Date() } } },
      { runValidators: true }
    );
  },

  // El cliente acepta a la vez los scopes `linkIds` del par que sigan sin
  // responder. El par actualizado, o null si ya no quedaba ninguno.
  async acceptInvitations(pairId, linkIds, clientId, { intakePending }) {
    return answerInvitations(pairId, linkIds, { status: "active", respondedAt: new Date() }, { clientId, intakePending });
  },

  async declineInvitations(pairId, linkIds) {
    return answerInvitations(pairId, linkIds, { status: "declined", respondedAt: new Date() });
  },

  // El profesional retira una invitación que nadie ha respondido.
  async cancelInvitation(trainerId, invitationId) {
    return moveInvitation({ trainerId }, invitationId, ["pending"], {
      status: "declined",
      revokedAt: new Date(),
      revokedBy: "trainer",
    });
  },

  // Termina el scope activo. Por el profesional: su par con ese cliente. Por
  // el cliente: el par del único profesional activo de ese scope.
  async revokeScope({ trainerId = null, clientId, scope, by }) {
    const filter = { clientId, scopes: activeLink(scope) };
    if (trainerId) filter.trainerId = trainerId;
    const pair = await TrainerClient.findOne(filter).select("scopes").lean();
    const link = pair?.scopes.find((candidate) => candidate.scope === scope && candidate.status === "active");
    if (!link) return null;
    return moveInvitation({ _id: pair._id }, link._id, ["active"], {
      status: "revoked",
      revokedAt: new Date(),
      revokedBy: by,
    });
  },

  // --- Datos del par ---------------------------------------------------------------

  async setTrainingGoal(pairId, trainingGoalType) {
    await TrainerClient.updateOne({ _id: pairId }, { $set: { trainingGoalType: trainingGoalType ?? null } });
  },

  // El cliente comparte (o deja de compartir) sus fotos anteriores a la
  // relación. false si no hay relación en curso.
  async setMediaHistory(trainerId, clientId, shared) {
    const now = new Date();
    const result = await TrainerClient.updateOne(
      { trainerId, clientId, scopes: activeLink() },
      { $set: { mediaHistorySharedAt: shared ? now : null, mediaHistoryAskedAt: now } }
    );
    return result.matchedCount > 0;
  },

  // El cliente envía (o reenvía) su cuestionario: reemplaza las respuestas,
  // vuelve a quedar sin revisar y deja de estar pendiente.
  async submitIntake(pairId, answers) {
    return TrainerClient.findOneAndUpdate(
      { _id: pairId },
      { $set: { intake: { ...answers, submittedAt: new Date(), reviewedAt: null }, intakePending: false } },
      { new: true, runValidators: true }
    ).lean();
  },

  // El profesional corrige las respuestas sin tocar el estado del envío.
  async updateIntakeAnswers(pairId, answers) {
    const dotted = Object.fromEntries(Object.entries(answers).map(([key, value]) => [`intake.${key}`, value]));
    const edited = await TrainerClient.findOneAndUpdate(
      { _id: pairId, intake: { $type: "object" } },
      { $set: dotted },
      { new: true, runValidators: true }
    ).lean();
    if (edited) return edited;
    return TrainerClient.findOneAndUpdate(
      { _id: pairId },
      { $set: { intake: { ...answers, submittedAt: null, reviewedAt: null } } },
      { new: true, runValidators: true }
    ).lean();
  },

  // Idempotente: si ya estaba revisado conserva la fecha original.
  async markIntakeReviewed(pairId) {
    await TrainerClient.updateOne(
      { _id: pairId, "intake.submittedAt": { $ne: null }, "intake.reviewedAt": null },
      { $set: { "intake.reviewedAt": new Date() } }
    );
    return TrainerClient.findById(pairId).lean();
  },

  // --- Umbrales de dolor ---------------------------------------------------------

  async listPainThresholds(trainerId, clientId) {
    return (await this.findPair(trainerId, clientId))?.painThresholds || [];
  },

  async setPainThreshold(trainerId, clientId, threshold) {
    return putInList(trainerId, clientId, "painThresholds", "zone", { ...threshold, updatedAt: new Date() });
  },

  async removePainThreshold(trainerId, clientId, zone) {
    if (!validIds(trainerId, clientId)) return;
    await TrainerClient.updateOne({ trainerId, clientId }, { $pull: { painThresholds: { zone } } });
  },

  // --- Vídeos de técnica asignados a un cliente ----------------------------------

  // [{ trainerId, exerciseId, techniqueVideoId }] del cliente: de un
  // profesional (`trainerId`) o de varios (`trainerIds`).
  async listTechniqueOverrides({ clientId, trainerId = null, trainerIds = null }) {
    const query = { clientId };
    if (trainerId) query.trainerId = trainerId;
    if (trainerIds) query.trainerId = { $in: trainerIds };
    const pairs = await TrainerClient.find(query).select("trainerId techniqueOverrides").lean();
    return pairs.flatMap((pair) =>
      (pair.techniqueOverrides || []).map((override) => ({ trainerId: pair.trainerId, ...override }))
    );
  },

  async setTechniqueOverride(trainerId, clientId, exerciseId, techniqueVideoId) {
    return putInList(trainerId, clientId, "techniqueOverrides", "exerciseId", {
      exerciseId: new mongoose.Types.ObjectId(String(exerciseId)),
      techniqueVideoId,
      assignedAt: new Date(),
    });
  },

  async removeTechniqueOverride(trainerId, clientId, exerciseId) {
    if (!validIds(trainerId, clientId, exerciseId)) return;
    await TrainerClient.updateOne({ trainerId, clientId }, { $pull: { techniqueOverrides: { exerciseId } } });
  },

  // Al borrar vídeos de un profesional, sus asignaciones a clientes se van con ellos.
  async removeTechniqueOverridesOfVideos(trainerId, techniqueVideoIds) {
    if (!techniqueVideoIds.length) return;
    await TrainerClient.updateMany(
      { trainerId, "techniqueOverrides.techniqueVideoId": { $in: techniqueVideoIds } },
      { $pull: { techniqueOverrides: { techniqueVideoId: { $in: techniqueVideoIds } } } }
    );
  },

  // Bandeja «Por revisar»: cuestionarios enviados y sin revisar de sus
  // clientes en curso, del más antiguo al más nuevo.
  async findUnreviewedIntakes(trainerId) {
    return TrainerClient.find({
      trainerId,
      scopes: activeLink(),
      intakePending: false,
      "intake.submittedAt": { $ne: null },
      "intake.reviewedAt": null,
    })
      .select("clientId intake.submittedAt")
      .sort({ "intake.submittedAt": 1 })
      .populate("clientId", "name lastname email")
      .lean();
  },
};
