const weightPlanDao = require("./weight-plan-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const userSchema = require("../users/schema");
const { complianceFor } = require("./weight-plan-service");

const MAX_INTERVAL_DAYS = 90;

function validInterval(value) {
  return Number.isInteger(value) && value >= 1 && value <= MAX_INTERVAL_DAYS;
}

module.exports = {
  // --- Lado profesional ---
  // GET /trainer/clients/:clientId/weight-plan
  // Devuelve la pauta Y su cumplimiento: por separado obligaría a la ficha a
  // pedir el histórico de antropometría solo para saber si el cliente va al día.
  async getForClient(req, res) {
    const plan = await weightPlanDao.findByTrainerAndClient(req.auth.userId, req.params.clientId);
    if (!plan) return res.send(null);
    const lastWeight = await anthropometryDao.findLastWeight(req.params.clientId);
    return res.send({ ...plan, compliance: complianceFor(plan, lastWeight) });
  },

  // PUT /trainer/clients/:clientId/weight-plan
  async upsertForClient(req, res) {
    const { intervalDays, notes } = req.body || {};
    if (!validInterval(Number(intervalDays))) {
      return res.status(400).send({
        message: `intervalDays debe ser un número entero de 1 a ${MAX_INTERVAL_DAYS} días`,
      });
    }
    if (notes !== undefined && (typeof notes !== "string" || notes.length > 500)) {
      return res.status(400).send({ message: "notes admite hasta 500 caracteres" });
    }

    const plan = await weightPlanDao.upsert(req.auth.userId, req.params.clientId, {
      intervalDays: Number(intervalDays),
      notes,
    });

    // Sin notificación al crearla: la pauta todavía no vence. El cliente la
    // ve en su pantalla de peso y en el resumen de su profesional, y el aviso
    // llega cuando de verdad toca (ver weight-plan-reminder-service.js).
    const lastWeight = await anthropometryDao.findLastWeight(req.params.clientId);
    return res.status(201).send({ ...plan, compliance: complianceFor(plan, lastWeight) });
  },

  // DELETE /trainer/clients/:clientId/weight-plan
  async removeForClient(req, res) {
    const plan = await weightPlanDao.remove(req.auth.userId, req.params.clientId);
    if (!plan) return res.status(404).send({ message: "Este cliente no tiene pauta de peso" });
    return res.sendStatus(204);
  },

  // --- Lado cliente ---
  // GET /trainer/weight-plans/mine — mismo criterio que el resto de "mine":
  // solo de profesionales con relación activa.
  async listMine(req, res) {
    const plans = await weightPlanDao.findByClient(req.auth.userId);
    if (!plans.length) return res.send([]);

    const visible = [];
    for (const plan of plans) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(
        plan.trainerId,
        req.auth.userId
      );
      if (relation) visible.push(plan);
    }
    if (!visible.length) return res.send([]);

    const lastWeight = await anthropometryDao.findLastWeight(req.auth.userId);
    const trainers = await userSchema
      .find({ _id: { $in: visible.map((plan) => plan.trainerId) } })
      .select("name lastname")
      .lean();
    const trainersById = new Map(trainers.map((trainer) => [String(trainer._id), trainer]));

    return res.send(
      visible.map((plan) => ({
        ...plan,
        trainer: trainersById.get(String(plan.trainerId)) || null,
        compliance: complianceFor(plan, lastWeight),
      }))
    );
  },
};
