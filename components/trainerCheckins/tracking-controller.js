const CheckinSchedule = require("./checkin-schedule-schema");
const CheckinRequest = require("./checkin-request-schema");
const weightPlanDao = require("../weightPlans/weight-plan-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const calendarService = require("./checkin-calendar-service");
const { occurrenceAt } = require("./checkin-schedule-dates");
const { complianceFor } = require("../weightPlans/weight-plan-service");
const { summarizeOccurrences } = require("./checkin-occurrences");
const { TRACKING_PRESETS, PRESET_BY_KEY, PRESET_BY_TRAINING_GOAL } = require("./tracking-presets");

const DEFAULT_TIME = "09:00";
const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";
const OVERDUE_WINDOW_DAYS = 60;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  // GET /trainer/tracking-presets — el catálogo y cuál sugiere el objetivo
  // de entrenamiento que ya tiene declarado este cliente.
  async listPresets(req, res) {
    const relation = req.params.clientId
      ? await trainerClientDao.findActiveByTrainerAndClient(req.auth.userId, req.params.clientId)
      : null;
    return res.send({
      presets: TRACKING_PRESETS,
      suggested: PRESET_BY_TRAINING_GOAL[relation?.trainingGoalType] || null,
    });
  },

  // GET /trainer/checkins/pending-reviews — check-ins ya contestados que
  // esperan una respuesta del entrenador, de TODA la cartera.
  //
  // El cliente que se molesta en contestar recibe señal de que alguien lo ha
  // leído; sin esto, revisar dependía de acordarse de entrar cliente a
  // cliente. No obliga a comentar: obligar produce treinta veces "todo bien,
  // seguimos", que es peor que el silencio porque parece atención.
  async pendingReviews(req, res) {
    const requests = await CheckinRequest.find({ trainerId: req.auth.userId, status: "responded" })
      .select("clientId name respondedAt")
      .populate("clientId", "name lastname")
      .sort({ respondedAt: 1 })
      .limit(20)
      .lean();

    return res.send(
      requests.map((request) => ({
        requestId: request._id,
        clientId: request.clientId?._id || request.clientId,
        clientName: request.clientId?.name
          ? `${request.clientId.name} ${request.clientId.lastname || ""}`.trim()
          : "Cliente",
        name: request.name,
        respondedAt: request.respondedAt,
      }))
    );
  },

  // GET /trainer/clients/:clientId/tracking — TODO lo que se le pide a este
  // cliente, en una sola respuesta.
  //
  // Estaba repartido en dos pestañas que no se hablaban: los check-ins por
  // un lado y las medidas por otro, sin ningún sitio donde ver la carga
  // total que se le está poniendo encima ni cuánto de ella se queda sin
  // contestar.
  async getForClient(req, res) {
    const { userId: trainerId } = req.auth;
    const { clientId } = req.params;
    const now = new Date();
    const since = new Date(now.getTime() - OVERDUE_WINDOW_DAYS * 86400000);

    const [schedules, requests, weightPlan, lastWeight] = await Promise.all([
      CheckinSchedule.find({ trainerId, clientId }).sort({ createdAt: 1 }).lean(),
      CheckinRequest.find({ trainerId, clientId, scheduledAt: { $gte: since } })
        .select("name scheduledAt closesAt status respondedAt")
        .sort({ scheduledAt: -1 })
        .lean(),
      weightPlanDao.findByTrainerAndClient(trainerId, clientId),
      anthropometryDao.findLastWeight(clientId),
    ]);

    const { answered, missed, open } = summarizeOccurrences(requests, now);

    return res.send({
      schedules,
      weightPlan: weightPlan ? { ...weightPlan, compliance: complianceFor(weightPlan, lastWeight, now) } : null,
      windowDays: OVERDUE_WINDOW_DAYS,
      answered,
      missed,
      open,
      // Sin email ni push, este bloque es la única red de seguridad: si el
      // cliente deja de responder, es aquí donde se ve.
      unanswered: requests
        .filter((request) => !["responded", "reviewed", "cancelled"].includes(request.status))
        .filter((request) => request.closesAt && new Date(request.closesAt) <= now)
        .slice(0, 10),
      pendingReview: requests.filter((request) => request.status === "responded").slice(0, 10),
    });
  },

  // POST /trainer/clients/:clientId/tracking-preset — body: { preset, timeZone }
  // Deja el seguimiento montado de una vez: pauta de peso, check-in de
  // bienestar y check-in de medidas, cada uno con su periodicidad.
  async applyPreset(req, res) {
    const preset = PRESET_BY_KEY.get(req.body?.preset);
    if (!preset) return res.status(400).send({ message: "Preset no reconocido" });

    const { userId: trainerId } = req.auth;
    const { clientId } = req.params;
    const now = new Date();
    const timeZone =
      typeof req.body?.timeZone === "string" && req.body.timeZone ? req.body.timeZone : DEFAULT_TIME_ZONE;

    await weightPlanDao.upsert(trainerId, clientId, {
      intervalDays: preset.weightIntervalDays,
      notes: "",
    });

    const creados = [];
    for (const [nombre, bloque] of [
      ["Check-in de seguimiento", preset.wellbeing],
      ["Medidas corporales", preset.measurements],
    ]) {
      const timing = {
        startDate: todayIso(),
        time: DEFAULT_TIME,
        timeZone,
        frequency: bloque.frequency,
        interval: bloque.interval,
      };
      const schedule = await CheckinSchedule.create({
        trainerId,
        clientId,
        name: nombre,
        enabledFields: bloque.fields,
        customQuestions: [],
        ...timing,
        nextRunAt: occurrenceAt(timing, 0),
      });
      // La primera solicitud sale ya: aplicar un preset y que el cliente no
      // vea nada durante una semana se lee como que no ha funcionado.
      await calendarService.materialize(schedule.toObject(), now);
      creados.push(schedule);
    }

    return res.status(201).send({ preset: preset.key, schedules: creados });
  },
};
