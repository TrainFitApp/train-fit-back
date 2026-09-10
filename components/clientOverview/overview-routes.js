const express = require("@awaitjs/express");
const mongoose = require("mongoose");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const { resolveStage } = require("./stage-service");
const service = require("./overview-service");
const intakeService = require("./intake-service");
const { upsertMeasurement } = require("./measurement-write");
const { fail } = require("./overview-domain");
const Relation = require("../trainerClients/trainer-client-schema");
const User = require("../users/schema");
const router = express.Router();
const consumerRouter = express.Router();

function handler(action, created = false) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      for (const key of ["clientId", "trainerId", "id"]) if (req.params[key] && !mongoose.isValidObjectId(req.params[key])) fail("Identificador inválido");
      const result = await action(req);
      return res.status(created ? 201 : 200).send(result);
    } catch (e) {
      const status = e.status || e.statusCode;
      if (status && status < 500) return res.status(status).send({ message: e.message, code: e.code, missingFields: e.missingFields, currentValues: e.currentValues, current: e.current });
      if (e.name === "ValidationError" || e.name === "CastError") return res.status(400).send({ message: "Datos inválidos" });
      console.error("Client overview:", e.message);
      return res.status(500).send({ message: "No se pudo completar la operación. Tu borrador sigue disponible." });
    }
  };
}
const guard = [auth(["trainer"]), requireActiveClient()];
const path = "/clients/:clientId/overview";
router.getAsync(path, ...guard, handler((r) => service.getOverview(r.auth.userId, r.params.clientId, r.query.stageId)));
router.getAsync(`${path}/context`, ...guard, handler(async (r) => {
  const { stage } = await resolveStage(r.auth.userId, r.params.clientId, r.query.stageId);
  return { values: stage.currentContext || {}, version: stage.version, updatedAt: stage.updatedAt, updatedBy: stage.updatedBy || null };
}));
router.getAsync(`${path}/intake`, ...guard, handler(async (r) => service.intakeDetail((await resolveStage(r.auth.userId, r.params.clientId, r.query.stageId)).stage)));
router.getAsync(`${path}/history`, ...guard, handler(async (r) => {
  const { stage } = await resolveStage(r.auth.userId, r.params.clientId, r.query.stageId);
  return { changes: stage.changes || [] };
}));
router.patchAsync(`${path}/context`, ...guard, handler((r) => service.updateContext(r.auth.userId, r.params.clientId, r.body || {})));
router.patchAsync(`${path}/settings`, ...guard, handler((r) => service.updateSettings(r.auth.userId, r.params.clientId, r.body || {})));
router.patchAsync(`${path}/profile`, ...guard, handler((r) => service.updateShared(r.auth.userId, r.params.clientId, r.body || {})));
router.patchAsync(`${path}/nutrition`, ...guard, requireActiveClient("nutrition"), handler((r) => service.updateShared(r.auth.userId, r.params.clientId, r.body || {}, true)));
router.postAsync(`${path}/baselines`, ...guard, handler((r) => intakeService.completeBaselines(r.auth.userId, r.params.clientId, r.body || {}, { professional: true })));
router.postAsync(`${path}/measurements`, ...guard, handler(async (r) => {
  await resolveStage(r.auth.userId, r.params.clientId, r.body?.stageId, { write: true });
  const { requestId, date, fields, expectedValues } = r.body || {};
  return upsertMeasurement({ trainerId: r.auth.userId, clientId: r.params.clientId, requestId, date, fields, expectedValues, source: "professional" });
}, true));
for (const [key, list, save] of [["notes", service.listNotes, service.saveNote], ["tasks", service.listTasks, service.saveTask], ["reviews", service.listReviews, service.createReview]]) {
  router.getAsync(`${path}/${key}`, ...guard, handler(async (r) => {
    const { stage } = await resolveStage(r.auth.userId, r.params.clientId, r.query.stageId);
    const limit = Math.max(1, Math.min(100, parseInt(r.query.limit, 10) || 50));
    const offset = Math.max(0, parseInt(r.query.offset, 10) || 0);
    return key === "tasks" ? list(r.auth.userId, r.params.clientId, stage, { limit, offset }) : list(r.auth.userId, r.params.clientId, stage, limit, offset);
  }));
  router.postAsync(`${path}/${key}`, ...guard, handler((r) => save(r.auth.userId, r.params.clientId, r.body || {}), true));
  if (key !== "reviews") router.patchAsync(`${path}/${key}/:id`, ...guard, handler((r) => save(r.auth.userId, r.params.clientId, r.body || {}, r.params.id)));
}
consumerRouter.getAsync("/me/coaching/initial-measurements", auth(["user", "admin"]), handler(async (r) => {
  const relations = await Relation.find({ clientId: r.auth.userId, status: { $in: ["active", "en_revision", "cuestionario_pendiente"] } }).lean();
  const trainerIds = [...new Set(relations.map((rel) => String(rel.trainerId)))];
  const items = await Promise.all(trainerIds.map(async (trainerId) => {
    const current = await intakeService.initialMeasurements(trainerId, r.auth.userId);
    if (!current.submitted || !current.missingFields.length) return null;
    const trainer = await User.findById(trainerId).select("name lastname").lean();
    return { trainerId, trainerName: [trainer?.name, trainer?.lastname].filter(Boolean).join(" "), stageId: current.stageId, missingFields: current.missingFields, requestedFields: current.requestedFields };
  }));
  return { items: items.filter(Boolean) };
}));
consumerRouter.getAsync("/me/coaching/:trainerId/initial-measurements", auth(["user", "admin"]), handler((r) => intakeService.initialMeasurements(r.params.trainerId, r.auth.userId)));
consumerRouter.postAsync("/me/coaching/:trainerId/initial-measurements", auth(["user", "admin"]), handler((r) => intakeService.completeBaselines(r.params.trainerId, r.auth.userId, r.body || {})));

module.exports = { router, consumerRouter, handler };
