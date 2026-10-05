const supplementDao = require("./supplement-dao");
const { SUPPLEMENT_TIMINGS } = require("./supplement-schema");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const userSchema = require("../users/schema");
const { todayForUser } = require("../users/user-time-zone");
const { todayIsoDate } = require("../util/date-util");

const TIMING_KEYS = new Set(SUPPLEMENT_TIMINGS.map((option) => option.key));

// Solo http(s). Sin esto, un `javascript:` escrito en el campo se
// convertiría en un enlace ejecutable en la app del cliente.
function sanitizeUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url.slice(0, 500) : "";
}

function sanitizeWeekdays(value) {
  if (!Array.isArray(value)) return [];
  const days = value
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
  // Los siete días es lo mismo que "todos los días", que se guarda vacío:
  // así la interfaz no tiene que distinguir dos formas de decir lo mismo.
  const unique = [...new Set(days)].sort();
  return unique.length === 7 ? [] : unique;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeDate(value, fallback = null) {
  return ISO_DATE.test(String(value || "")) ? String(value) : fallback;
}

// `today` = hoy en la zona del cliente.
function sanitizeBody(body, today) {
  const name = String(body?.name || "").trim().slice(0, 120);
  const dose = String(body?.dose || "").trim().slice(0, 60);
  if (!name || !dose) return null;

  const timing = TIMING_KEYS.has(body?.timing) ? body.timing : "with_meal";
  // Sin fecha de inicio, desde hoy: una pauta que existe se está tomando ya.
  const startDate = sanitizeDate(body?.startDate, today);
  const endDate = sanitizeDate(body?.endDate);
  if (endDate && endDate < startDate) return null;

  return {
    startDate,
    endDate,
    name,
    dose,
    timing,
    // Solo se guarda si de verdad aplica: un texto de "otro momento"
    // arrastrado tras cambiar a "antes de entrenar" contradiría al enum.
    customTiming:
      timing === "custom" ? String(body?.customTiming || "").trim().slice(0, 100) : "",
    reason: String(body?.reason || "").trim().slice(0, 300),
    purchaseUrl: sanitizeUrl(body?.purchaseUrl),
    weekdays: sanitizeWeekdays(body?.weekdays),
    active: body?.active !== false,
  };
}

module.exports = {
  // El vocabulario lo decide el backend, igual que en dolor y en reglas.
  async getTimings(_req, res) {
    return res.send({ timings: SUPPLEMENT_TIMINGS });
  },

  // --- Lado profesional ---
  async listForClient(req, res) {
    const supplements = await supplementDao.listForClient(
      req.auth.userId,
      req.params.clientId
    );
    return res.send(supplements);
  },

  async create(req, res) {
    const data = sanitizeBody(req.body, await todayForUser(req.params.clientId));
    if (!data) {
      return res.status(400).send({
        message: "Revisa el nombre, la dosis y las fechas",
        code: "SUPPLEMENT_INVALID",
      });
    }

    try {
      const supplement = await supplementDao.create(
        req.auth.userId,
        req.params.clientId,
        data
      );
      return res.status(201).send(supplement);
    } catch (error) {
      // 11000 = choque con el índice único {trainerId, clientId, name}.
      // Se traduce a un mensaje que dice qué hacer, en vez de un 500.
      if (error?.code === 11000) {
        return res.status(409).send({
          message: `Ya le has pautado "${data.name}". Edita el que tienes en vez de crear otro.`,
          code: "SUPPLEMENT_DUPLICATE",
        });
      }
      throw error;
    }
  },

  async update(req, res) {
    const data = sanitizeBody(req.body, await todayForUser(req.params.clientId));
    if (!data) {
      return res.status(400).send({
        message: "Revisa el nombre, la dosis y las fechas",
        code: "SUPPLEMENT_INVALID",
      });
    }

    const supplement = await supplementDao.update(
      req.auth.userId,
      req.params.clientId,
      req.params.supplementId,
      data
    );
    if (!supplement) return res.status(404).send({ message: "Suplemento no encontrado" });
    return res.send(supplement);
  },

  async remove(req, res) {
    await supplementDao.remove(
      req.auth.userId,
      req.params.clientId,
      req.params.supplementId
    );
    return res.sendStatus(204);
  },

  // --- Lado cliente ---
  // Sus suplementos activos, de CUALQUIER profesional con relación viva. Se
  // filtra por relación y no por trainerId de la URL: el cliente no elige de
  // quién los ve, los ve todos — pero solo de quien sigue siendo su
  // profesional. Mismo criterio que trainer-task-controller#listMine.
  async listMine(req, res) {
    const clientId = req.auth.userId;
    // Solo los vigentes hoy (o en la fecha que pida la app: la pantalla de
    // dieta los pinta debajo de las comidas del día que se está mirando).
    const date = sanitizeDate(req.query?.date, todayIsoDate(req.auth.timeZone));
    const supplements = await supplementDao.listActiveForClient(clientId, date);
    if (!supplements.length) return res.send([]);

    // Una comprobación por PROFESIONAL, no por suplemento: un cliente con
    // seis suplementos del mismo entrenador haría seis consultas idénticas.
    const trainerIds = [...new Set(supplements.map((s) => String(s.trainerId)))];
    const activeTrainerIds = new Set();
    for (const trainerId of trainerIds) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId);
      if (relation) activeTrainerIds.add(trainerId);
    }

    const visible = supplements.filter((s) => activeTrainerIds.has(String(s.trainerId)));
    if (!visible.length) return res.send([]);

    // Quién se lo pautó: el cliente puede tener entrenador y nutricionista, y
    // "tómate esto" sin saber de quién viene no se sigue igual.
    const trainers = await userSchema
      .find({ _id: { $in: [...activeTrainerIds] } })
      .select("name lastname")
      .lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    return res.send(
      visible.map((supplement) => {
        const trainer = trainersById.get(String(supplement.trainerId));
        return {
          ...supplement,
          trainerName: trainer
            ? `${trainer.name || ""} ${trainer.lastname || ""}`.trim()
            : "Tu profesional",
        };
      })
    );
  },
};
