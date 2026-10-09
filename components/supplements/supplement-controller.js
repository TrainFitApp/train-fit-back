const supplementService = require("./supplement-service");
const { SUPPLEMENT_TIMINGS } = require("./supplement-catalog");
const { todayForUser } = require("../users/user-time-zone");
const { todayIsoDate } = require("../util/date-util");
const { badRequest } = require("../util/http-error");

const TIMING_KEYS = new Set(SUPPLEMENT_TIMINGS.map((option) => option.key));

// Solo http(s). Sin esto, un `javascript:` escrito en el campo se
// convertiría en un enlace ejecutable en la app del cliente.
function sanitizeUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  return /^https?:\/\//i.test(url) ? url.slice(0, 500) : "";
}

// Un valor fuera de catálogo se rechaza (QA 2026-10-09, M15): antes
// `weekdays: [9]` se descartaba y quedaba `[]` («todos los días») y un
// `timing` desconocido se guardaba como «con una comida», sin error.
const invalid = (field, message) => badRequest(message, "SUPPLEMENT_INVALID", { field });

function sanitizeWeekdays(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid("weekdays", "Los días tienen que ser una lista");
  const days = value.map((day) => Number(day));
  if (days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw invalid("weekdays", "Los días van del 0 (domingo) al 6 (sábado)");
  }
  // Los siete días es lo mismo que "todos los días", que se guarda vacío:
  // así la interfaz no tiene que distinguir dos formas de decir lo mismo.
  const unique = [...new Set(days)].sort();
  return unique.length === 7 ? [] : unique;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sanitizeDate(value, fallback = null) {
  return ISO_DATE.test(String(value || "")) ? String(value) : fallback;
}

// Una fecha que viene tiene que ser un día "YYYY-MM-DD".
function optionalDate(body, field, fallback = null) {
  const value = body?.[field];
  if (value === undefined || value === null || value === "") return fallback;
  if (!ISO_DATE.test(String(value))) throw invalid(field, "Fecha no válida");
  return String(value);
}

// `today` = hoy en la zona del cliente.
function sanitizeBody(body, today) {
  const name = String(body?.name || "").trim().slice(0, 120);
  const dose = String(body?.dose || "").trim().slice(0, 60);
  if (!name || !dose) return null;

  const rawTiming = body?.timing;
  if (rawTiming !== undefined && rawTiming !== null && rawTiming !== "" && !TIMING_KEYS.has(rawTiming)) {
    throw invalid("timing", "Momento de la toma no válido");
  }
  const timing = rawTiming && TIMING_KEYS.has(rawTiming) ? rawTiming : "with_meal";
  // Sin fecha de inicio, desde hoy: una pauta que existe se está tomando ya.
  const startDate = optionalDate(body, "startDate", today);
  const endDate = optionalDate(body, "endDate");
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

// El cuerpo saneado o un 400: nombre y dosis obligatorios y fechas en orden.
function requireBody(body, today) {
  const data = sanitizeBody(body, today);
  if (!data) throw badRequest("Revisa el nombre, la dosis y las fechas", "SUPPLEMENT_INVALID");
  return data;
}

// Lo que decide el cliente de sus propios suplementos. El resto (motivo,
// enlace, días, fin) es de la pauta de un profesional; desde qué día se toma
// lo fija el alta y editar no lo mueve.
function ownFields({ name, dose, timing, customTiming }) {
  return { name, dose, timing, customTiming };
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
    const data = requireBody(req.body, await todayForUser(req.params.clientId));
    const supplement = await supplementService.create(req.auth.userId, req.params.clientId, data);
    return res.status(201).send(supplement);
  },

  async update(req, res) {
    const data = requireBody(req.body, await todayForUser(req.params.clientId));
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
  // de cualquier profesional con relación viva, y los que se apuntó él.
  async listMine(req, res) {
    const date = sanitizeDate(req.query?.date, todayIsoDate(req.auth.timeZone));
    return res.send(await supplementService.listActiveForClient(req.auth.userId, date));
  },

  // Los que se apunta él mismo, desde la pantalla de dieta. Se toman desde
  // `startDate` (el día que estaba mirando; hoy si no lo manda).
  async createMine(req, res) {
    const data = requireBody(req.body, todayIsoDate(req.auth.timeZone));
    const supplement = await supplementService.createOwn(req.auth.userId, {
      ...ownFields(data),
      startDate: data.startDate,
    });
    return res.status(201).send(supplement);
  },

  async updateMine(req, res) {
    const data = ownFields(requireBody(req.body, todayIsoDate(req.auth.timeZone)));
    return res.send(await supplementService.updateOwn(req.auth.userId, req.params.supplementId, data));
  },

  async removeMine(req, res) {
    await supplementService.removeOwn(req.auth.userId, req.params.supplementId);
    return res.sendStatus(204);
  },
};
