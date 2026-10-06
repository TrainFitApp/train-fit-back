const supplementService = require("./supplement-service");
const { SUPPLEMENT_TIMINGS } = require("./supplement-catalog");
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
    const supplements = await supplementService.listForClient(req.auth.userId, req.params.clientId);
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

    const supplement = await supplementService.create(req.auth.userId, req.params.clientId, data);
    return res.status(201).send(supplement);
  },

  async update(req, res) {
    const data = sanitizeBody(req.body, await todayForUser(req.params.clientId));
    if (!data) {
      return res.status(400).send({
        message: "Revisa el nombre, la dosis y las fechas",
        code: "SUPPLEMENT_INVALID",
      });
    }

    const supplement = await supplementService.update(req.auth.userId, req.params.clientId, req.params.supplementId, data);
    if (!supplement) return res.status(404).send({ message: "Suplemento no encontrado" });
    return res.send(supplement);
  },

  async remove(req, res) {
    await supplementService.remove(req.auth.userId, req.params.clientId, req.params.supplementId);
    return res.sendStatus(204);
  },

  // --- Lado cliente ---
  // Sus suplementos vigentes hoy (o en la fecha que pida la app: la pantalla
  // de dieta los pinta debajo de las comidas del día que se está mirando),
  // de cualquier profesional con relación viva.
  async listMine(req, res) {
    const date = sanitizeDate(req.query?.date, todayIsoDate(req.auth.timeZone));
    return res.send(await supplementService.listActiveForClient(req.auth.userId, date));
  },
};
