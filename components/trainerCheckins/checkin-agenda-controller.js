const agenda = require("./checkin-agenda-service");
const scheduleService = require("./checkin-schedule-service");
const { validateTiming, validDate } = require("./checkin-schedule-dates");
const { todayForUser } = require("../users/user-time-zone");

const validId = (id) => typeof id === "string" && /^[a-f\d]{24}$/i.test(id);
const notFound = (res) => res.status(404).send({ message: "Check-in no encontrado" });

// Tope del resumen de Seguimiento: el chip más largo es "3 años".
const MAX_SUMMARY_DAYS = 3 * 365;

module.exports = {
  // GET /trainer/clients/:clientId/checkin-agenda?from&to
  async agenda(req, res) {
    const { from, to } = req.query;
    if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 370 * 86400000) {
      return res.status(400).send({ message: "Elige un rango de hasta un año" });
    }
    return res.send(await agenda.agendaView(req.auth.userId, req.params.clientId, from, to));
  },

  // GET /trainer/clients/:clientId/checkin-summary?days=N — de las ocurrencias
  // de los últimos N días (hoy incluido), cuántas siguen abiertas y cuántas
  // se cerraron sin respuesta. Calculado al vuelo, igual que la agenda.
  async summary(req, res) {
    const days = Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_SUMMARY_DAYS) {
      return res.status(400).send({ message: "Elige un rango de hasta 3 años" });
    }
    const today = await todayForUser(req.params.clientId);
    const { open, missed } = await agenda.summaryFor(req.auth.userId, req.params.clientId, days - 1, today);
    return res.send({ days, open, missed });
  },

  // GET /trainer/clients/:clientId/checkin-schedules
  // Las programaciones a secas, sin agenda: lo que necesita la ficha para
  // decir "2 check-ins" y abrir el panel. Pedir la agenda entera para esto
  // traería un año de ocurrencias calculadas que nadie va a pintar.
  async listSchedules(req, res) {
    return res.send(await scheduleService.list(req.auth.userId, req.params.clientId));
  },

  // GET /trainer/clients/:clientId/checkin-schedules/:scheduleId/history?before&limit
  // Todas las ocurrencias de UNA programación, de la más nueva a la más
  // vieja, respondidas o no. Sin tope de rango: pagina hacia atrás con
  // `before` (la fecha que devuelve `nextBefore`).
  async scheduleHistory(req, res) {
    const { before, limit } = req.query || {};
    if (!validId(req.params.scheduleId)) return notFound(res);
    if (before !== undefined && !validDate(before)) {
      return res.status(400).send({ message: "before inválida (YYYY-MM-DD)" });
    }
    const size = limit === undefined ? 50 : Number(limit);
    if (!Number.isInteger(size) || size < 1 || size > 200) {
      return res.status(400).send({ message: "limit debe estar entre 1 y 200" });
    }

    return res.send(
      await scheduleService.history(req.auth.userId, req.params.clientId, req.params.scheduleId, {
        before: before || null,
        limit: size,
      })
    );
  },

  // POST/PUT /trainer/clients/:clientId/checkin-schedules[/:scheduleId]
  async saveSchedule(req, res) {
    const data = req.body || {};
    const timingError = validateTiming(data);
    if (timingError) return res.status(400).send({ message: timingError });
    if (typeof data.name !== "string" || !data.name.trim() || data.name.trim().length > 100) {
      return res.status(400).send({ message: "Escribe un nombre de hasta 100 caracteres" });
    }

    if (req.params.scheduleId && !validId(req.params.scheduleId)) return notFound(res);

    const { created, schedule } = await scheduleService.save(req.auth.userId, req.params.clientId, req.params.scheduleId, data);
    return res.status(created ? 201 : 200).send(schedule);
  },

  // POST /trainer/clients/:clientId/checkin-schedules/:scheduleId/request —
  // "Enviarlo ahora". Sin solicitudes guardadas no se adelanta la ocurrencia:
  // se crea una programación "once" de hoy con las mismas preguntas (mismos
  // _id en las propias, para que sus respuestas se sigan leyendo igual). Si
  // hoy ya tiene una abierta sin responder, no se duplica.
  async requestNow(req, res) {
    if (!validId(req.params.scheduleId)) return notFound(res);
    const result = await scheduleService.requestNow(req.auth.userId, req.params.clientId, req.params.scheduleId);
    return result.alreadyOpen ? res.send(result) : res.status(201).send(result.created);
  },

  // PATCH /trainer/clients/:clientId/checkin-schedules/:scheduleId/active
  async setActive(req, res) {
    if (!validId(req.params.scheduleId) || typeof req.body?.active !== "boolean") {
      return res.status(400).send({ message: "Programación no válida" });
    }
    await scheduleService.setActive(req.auth.userId, req.params.clientId, req.params.scheduleId, req.body.active);
    return res.sendStatus(204);
  },

  // DELETE /trainer/clients/:clientId/checkin-schedules/:scheduleId — quita la
  // programación. Las respuestas ya dadas se quedan: son historial del
  // cliente, no de la programación.
  async deleteSchedule(req, res) {
    if (!validId(req.params.scheduleId)) return notFound(res);
    await scheduleService.remove(req.auth.userId, req.params.clientId, req.params.scheduleId);
    return res.sendStatus(204);
  },

  // POST /trainer/clients/:clientId/checkin-responses/:responseId/review
  async review(req, res) {
    if (!validId(req.params.responseId)) return notFound(res);
    const comment = req.body?.comment ?? "";
    if (typeof comment !== "string" || comment.length > 2000) {
      return res.status(400).send({ message: "El comentario admite hasta 2000 caracteres" });
    }
    const reviewed = await scheduleService.review(req.auth.userId, req.params.clientId, req.params.responseId, comment.trim());
    return res.send(reviewed);
  },
};
