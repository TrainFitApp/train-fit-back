const trainerClientService = require("./trainer-client-service");
const trainerClientDto = require("./trainer-client-dto");
const trainerClientDao = require("./trainer-client-dao");
const trainerSeatService = require("./trainer-seat-service");

// Marca los clientes fuera de las plazas activas (cartera por encima del cupo).
async function withSeatFlags(trainerId, clients) {
  const state = await trainerSeatService.seatState(trainerId);
  if (!state.overLimit) return clients;
  return clients.map((client) => ({ ...client,
    readOnly: Boolean(client.user?._id) && !state.active.has(String(client.user._id)) }));
}
const clientIntakeDao = require("../clientIntake/client-intake-dao");
const trainerPaymentDao = require("../trainerPayments/trainer-payment-dao");
const coachAlertDao = require("../coachAlerts/coach-alert-dao");
const coachAlertService = require("../coachAlerts/coach-alert-service");

// Los 3 únicos tipos que este endpoint devolvía antes de la Fase 1 Coach
// Pro. CoachAlert produce 8; los 5 restantes se filtran aquí a propósito
// —ver getAttentionItems— para no cambiar el contrato de un cliente ya
// desplegado.
const LEGACY_ATTENTION_TYPES = ["pending_review", "plan_ending_soon", "checkin_overdue"];

function handleKnownError(res, e) {
  if (e.code === "OVERLAP" || e.code === "DUPLICATE_INVITE" || e.code === "NOT_A_USER_ACCOUNT") {
    return res.status(400).send({ message: e.message, code: e.code });
  }
  if (e.code === "TRAINER_LIMIT_REACHED") {
    return res.status(403).send({ message: e.message, code: e.code });
  }
  if (e.code === "FORBIDDEN") {
    return res.status(403).send({ message: e.message });
  }
  return null;
}

const controller = {
  // POST /trainer/invites — { clientEmail, scopes: [...] }
  async inviteClient(req, res) {
    try {
      const { clientEmail, scopes } = req.body;
      const results = await trainerClientService.inviteClient(
        req.auth.userId,
        req.user,
        clientEmail,
        Array.isArray(scopes) ? scopes : [scopes]
      );
      const anySuccess = results.some((r) => r.success);
      return res.status(anySuccess ? 201 : 400).send({
        results: results.map((r) => ({
          scope: r.scope,
          success: r.success,
          error: r.error || null,
          relation: r.relation ? trainerClientDto.single(r.relation) : null,
        })),
      });
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en inviteClient:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/clients/check-email?email=...
  async checkClientEmailStatus(req, res) {
    const status = await trainerClientService.checkClientEmailStatus(req.auth.userId, req.query.email);
    return res.send(status);
  },

  // GET /trainer/invites
  async listInvitesByTrainer(req, res) {
    const invites = await trainerClientService.listInvitesByTrainer(req.auth.userId);
    // Express genera ETag automáticamente para cualquier res.send() con JSON
    // (etag activado por defecto) — dos GET seguidas con el mismo contenido
    // (nada cambió entre pedir el listado y volver a pedirlo) devuelven un
    // 304 sin cuerpo. El navegador debería rellenarlo con la respuesta
    // cacheada, pero cuando no lo hace (caché vaciada/incógnito/disco), el
    // frontend recibe un body vacío sin ningún error — se ve como
    // "invitaciones pendientes" desaparecidas de la nada. Este listado
    // cambia por acción del propio trainer (invitar/cancelar), nunca hace
    // falta servirlo desde caché condicional.
    res.set("Cache-Control", "no-store");
    return res.send(trainerClientDto.multipleWithClient(invites));
  },

  // DELETE /trainer/invites/:id
  async cancelInvite(req, res) {
    const result = await trainerClientService.cancelInvite(req.auth.userId, req.params.id);
    if (!result) return res.sendStatus(404);
    return res.send(trainerClientDto.single(result));
  },

  // GET /trainer/invites/mine
  async listInvitesMine(req, res) {
    const invites = await trainerClientService.listPendingForClientEmailEnriched(req.auth.email);
    return res.send(trainerClientDto.multipleWithTrainer(invites));
  },

  // POST /trainer/invites/:id/accept
  async acceptInvite(req, res) {
    try {
      const result = await trainerClientService.respondToInvite(req.params.id, req.user, "accept");
      if (!result) return res.sendStatus(404);
      return res.send(trainerClientDto.single(result));
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en acceptInvite:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // POST /trainer/invites/:id/decline
  async declineInvite(req, res) {
    try {
      const result = await trainerClientService.respondToInvite(req.params.id, req.user, "decline");
      if (!result) return res.sendStatus(404);
      return res.send(trainerClientDto.single(result));
    } catch (e) {
      const handled = handleKnownError(res, e);
      if (handled) return handled;
      console.error("Error en declineInvite:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/info — profesionales activos del cliente autenticado,
  // agregados por profesional (mismo patrón que F05 del lado trainer).
  async listMyProfessionals(req, res) {
    const aggregatedProfessionals = await trainerClientService.listActiveProfessionalsForClient(
      req.auth.userId
    );
    return res.send(trainerClientDto.multipleAggregated(aggregatedProfessionals));
  },

  // GET /trainer/clients — clientes activos del profesional, agregados por cliente
  async listMyClients(req, res) {
    const aggregated = await trainerClientService.listActiveClientsForTrainer(req.auth.userId);
    return res.send(await withSeatFlags(req.auth.userId, trainerClientDto.multipleAggregated(aggregated)));
  },

  // GET /trainer/clients/lifetime-count — "Mi cuenta" > tarjeta "Número de
  // cambios". Ruta propia y aditiva (no reemplaza listMyClients: ese array
  // completo lo siguen consumiendo dashboard/select-clients-modal/etc. tal
  // cual, cambiar su forma de respuesta los rompería).
  async getLifetimeClientsCount(req, res) {
    const total = await trainerClientDao.countLifetimeActiveClients(req.auth.userId);
    return res.send({ total });
  },

  // GET /trainer/payments/summary — cobros agregados de TODOS los clientes
  // del trainer (dashboard, tarjeta + gráfica "Cobros"): pendiente/vencido
  // actual + serie mensual de los últimos 6 meses + variación vs mes
  // pasado. Ver trainer-payment-dao.js#getPaymentsOverview.
  async getPaymentsSummary(req, res) {
    const summary = await trainerPaymentDao.getPaymentsOverview(req.auth.userId);
    return res.send(summary);
  },

  // GET /trainer/dashboard/attention-items — SUPERSEDIDO por
  // GET /trainer/alerts (ver coachAlerts/). Se mantiene, y con el mismo
  // contrato exacto, porque esta app se distribuye también como build nativa
  // (build:i:t / build:a:t) y hay instalaciones que seguirán llamando aquí
  // hasta que actualicen.
  //
  // Lo que SÍ cambia es de dónde salen los datos: antes recalculaba las 3
  // señales al vuelo en cada petición; ahora lee las alertas que ya calculó
  // la evaluación diaria (ensureEvaluatedToday). Mantener las dos
  // implementaciones habría sido exactamente la duplicación de lógica que este trabajo evita — y con el
  // agravante de que podrían discrepar entre sí (dos definiciones de "check-in
  // vencido" divergiendo con el tiempo).
  //
  // Se filtran los 3 tipos originales: un cliente antiguo no sabe pintar los
  // 5 nuevos y su `attentionLabel()` devolvería cadena vacía para ellos —
  // filas en blanco. El orden lo da el DAO (prioridad, luego más reciente),
  // que es el mismo criterio de urgencia que aplicaba el sort anterior.
  async getAttentionItems(req, res) {
    await coachAlertService.ensureEvaluatedToday(req.auth.userId);
    const alerts = await coachAlertDao.listForTrainer(req.auth.userId, { status: "open" });

    const items = alerts
      .filter((alert) => LEGACY_ATTENTION_TYPES.includes(alert.type))
      .map((alert) => ({
        type: alert.type,
        clientId: alert.clientId,
        clientName: alert.client
          ? `${alert.client.name} ${alert.client.lastname}`.trim()
          : "Cliente",
        // Solo lo llevaba plan_ending_soon; ahora vive dentro de context.
        ...(alert.type === "plan_ending_soon" ? { daysLeft: alert.context?.daysLeft ?? 0 } : {}),
      }));

    return res.send(items);
  },

  // GET /trainer/clients/paginated?page=&limit=&search=
  // TASK-022 (MASTER_BACKLOG.md) — variante paginada para la lista "Clientes"
  // del trainer. Ruta nueva y aditiva: no sustituye a listMyClients, que
  // otros 5 consumidores del frontend (dashboard, select-clients-modal,
  // client-detail fallback, checkin-templates) siguen usando tal cual
  // porque genuinamente necesitan la lista completa.
  async listMyClientsPaginated(req, res) {
    const page = parseInt((req.query.page || "0").toString(), 10);
    const limit = parseInt((req.query.limit || "20").toString(), 10);
    const search = req.query.search || "";

    const result = await trainerClientService.listActiveClientsForTrainerPaginated(req.auth.userId, {
      page,
      limit,
      search,
    });

    return res.send({
      clients: await withSeatFlags(req.auth.userId, trainerClientDto.multipleAggregated(result.clients)),
      total: result.total,
    });
  },

  // DELETE /trainer/clients/:clientId?scope=training|nutrition
  async revokeByTrainer(req, res) {
    const { scope } = req.query;
    if (!scope) return res.status(400).send({ message: "scope es obligatorio" });
    const result = await trainerClientService.revokeByTrainer(req.auth.userId, req.params.clientId, scope);
    if (!result) return res.sendStatus(404);
    return res.send(trainerClientDto.single(result));
  },

  // DELETE /trainer/link/:scope
  async revokeByClient(req, res) {
    const result = await trainerClientService.revokeByClient(req.auth.userId, req.params.scope);
    if (!result) return res.sendStatus(404);
    return res.send(trainerClientDto.single(result));
  },

  // GET /trainer/history (profesional) o ?asClient=1 (cliente) — historial revoked/declined
  async listHistory(req, res) {
    if (req.query.asClient) {
      const relations = await trainerClientService.listHistoryByClient(req.auth.userId);
      return res.send(trainerClientDto.multipleWithTrainer(relations));
    }
    const relations = await trainerClientService.listHistoryByTrainer(req.auth.userId);
    return res.send(trainerClientDto.multiple(relations));
  },

  // --- TAREA 3: cuestionario inicial + confirmación ---

  // GET /trainer/onboarding-status — cliente: ¿debe ver la pantalla de estado
  // (cuestionario/en revisión) en vez del resto de la app?
  async getOnboardingStatus(req, res) {
    const status = await trainerClientService.getOnboardingStatus(req.auth.userId);
    return res.send(status);
  },

  // GET /trainer/intake/:trainerId — el propio cliente recupera lo que ya
  // le había respondido a este trainer (o null si nunca lo hizo). Para
  // precargar el formulario cuando ese mismo trainer añade un scope nuevo
  // más tarde (p.ej. ya rellenó nutrición, ahora también invita a
  // entrenamiento): sin esto, "completar" el cuestionario del mismo trainer
  // una segunda vez partía de cero y perdía lo ya respondido.
  async getMyIntake(req, res) {
    const intake = await clientIntakeDao.getByTrainerAndClient(req.params.trainerId, req.auth.userId);
    return res.send(intake);
  },

  // POST /trainer/intake — cliente envía su cuestionario inicial para un
  // profesional concreto. body: { trainerId, goals, healthConditions,
  // experienceLevel, availability, trainingLocation, equipmentTags,
  // allergies, favoriteFoods, dislikedFoods, cooksAtHome,
  // customAnswers: [{ questionId, label, value }] }
  async submitIntake(req, res) {
    try {
      const { trainerId, ...intakeData } = req.body || {};
      if (!trainerId) return res.status(400).send({ message: "trainerId es obligatorio" });
      const intake = await trainerClientService.submitIntake(trainerId, req.auth.userId, intakeData);
      return res.status(201).send(intake);
    } catch (e) {
      if (e.code === "NO_INTAKE_PENDING") {
        return res.status(400).send({ message: e.message, code: e.code });
      }
      console.error("Error en submitIntake:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/clients/:clientId/intake — el profesional revisa el
  // cuestionario. NO usa requireActiveClient a propósito: la relación está
  // en "en_revision" (aún no "active") justo cuando hace falta revisarla.
  async getClientIntake(req, res) {
    const trainerId = req.auth.userId;
    const clientId = req.params.clientId;
    const relations = await trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, [
      "en_revision",
      "active",
    ]);
    if (!relations.length) {
      return res.status(403).send({
        message: "No tienes una relación con este cliente que permita ver su cuestionario",
      });
    }
    const intake = await clientIntakeDao.getByTrainerAndClient(trainerId, clientId);
    return res.send(intake);
  },

  // PUT /trainer/clients/:clientId/intake — el profesional corrige el
  // cuestionario del cliente (mismo control de acceso que getClientIntake).
  // A propósito NO pasa por trainerClientService.submitIntake: ese método
  // exige status "cuestionario_pendiente" y además reescribe preferencias
  // nutricionales/perfil de User — aquí solo se corrigen los campos propios
  // de ClientIntake, sin tocar el estado de la relación ni disparar de nuevo
  // esos efectos secundarios pensados para el envío inicial del cliente.
  async updateClientIntake(req, res) {
    const trainerId = req.auth.userId;
    const clientId = req.params.clientId;
    const relations = await trainerClientDao.findByTrainerAndClientInStatuses(trainerId, clientId, [
      "en_revision",
      "active",
    ]);
    if (!relations.length) {
      return res.status(403).send({
        message: "No tienes una relación con este cliente que permita editar su cuestionario",
      });
    }
    const intake = await clientIntakeDao.upsert(trainerId, clientId, req.body || {});
    return res.send(intake);
  },

  // POST /trainer/clients/:clientId/confirm — el profesional confirma
  // explícitamente al cliente tras revisar su cuestionario.
  async confirmClient(req, res) {
    try {
      const result = await trainerClientService.confirmClient(req.auth.userId, req.params.clientId);
      return res.send(trainerClientDto.multiple(result));
    } catch (e) {
      if (e.code === "NO_INTAKE_IN_REVIEW") {
        return res.status(400).send({ message: e.message, code: e.code });
      }
      console.error("Error en confirmClient:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },

  // GET /trainer/seats — plazas activas cuando la cartera supera el cupo del plan.
  async getSeats(req, res) {
    res.set("Cache-Control", "no-store");
    return res.send(await trainerSeatService.listSeats(req.auth.userId));
  },

  // PUT /trainer/seats { clientIds } — el entrenador elige qué clientes siguen activos.
  async updateSeats(req, res) {
    try {
      return res.send(await trainerSeatService.setSeats(req.auth.userId, req.body?.clientIds));
    } catch (e) {
      if (e.status) return res.status(e.status).send({ message: e.message, code: e.code });
      console.error("Error en updateSeats:", e.message);
      return res.status(500).send({ message: "Internal Server Error" });
    }
  },
};

module.exports = controller;
