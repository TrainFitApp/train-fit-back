const checkinDao = require("./checkin-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const notificationDao = require("../notifications/notification-dao");
const userSchema = require("../users/schema");
const { CHECKIN_FIELDS_BY_KEY, CHECKIN_FIELD_KEYS } = require("./checkin-field-catalog");

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function validEnabledFields(enabledFields) {
  return (
    Array.isArray(enabledFields) &&
    enabledFields.every((f) => CHECKIN_FIELD_KEYS.includes(f))
  );
}

module.exports = {
  // --- Lado profesional: CRUD de plantillas maestras ---
  async listDefinitions(req, res) {
    const definitions = await checkinDao.listDefinitions(req.auth.userId);
    return res.send(definitions);
  },

  async createDefinition(req, res) {
    const { name, enabledFields, cadence } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).send({ message: "name es obligatorio" });
    }
    if (!validEnabledFields(enabledFields || [])) {
      return res.status(400).send({ message: "enabledFields contiene una clave no reconocida en el catálogo" });
    }
    try {
      const definition = await checkinDao.createDefinition(
        req.auth.userId,
        name.trim(),
        enabledFields || [],
        cadence || "weekly"
      );
      return res.status(201).send(definition);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes una plantilla con ese nombre" });
      }
      throw e;
    }
  },

  async updateDefinition(req, res) {
    const { name, enabledFields, cadence } = req.body || {};
    if (enabledFields && !validEnabledFields(enabledFields)) {
      return res.status(400).send({ message: "enabledFields contiene una clave no reconocida en el catálogo" });
    }
    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (enabledFields !== undefined) updates.enabledFields = enabledFields;
    if (cadence !== undefined) updates.cadence = cadence;

    try {
      const definition = await checkinDao.updateDefinition(req.auth.userId, req.params.id, updates);
      if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });
      return res.send(definition);
    } catch (e) {
      if (e.code === 11000) {
        return res.status(409).send({ message: "Ya tienes una plantilla con ese nombre" });
      }
      throw e;
    }
  },

  async deleteDefinition(req, res) {
    const definition = await checkinDao.deleteDefinition(req.auth.userId, req.params.id);
    if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });
    return res.sendStatus(204);
  },

  // POST /trainer/checkin-templates/:id/apply — body: { clientIds: [...] }
  async applyDefinition(req, res) {
    const definition = await checkinDao.getDefinitionById(req.auth.userId, req.params.id);
    if (!definition) return res.status(404).send({ message: "Plantilla no encontrada" });

    const clientIds = Array.isArray(req.body?.clientIds) ? req.body.clientIds : [];
    if (!clientIds.length) {
      return res.status(400).send({ message: "clientIds es obligatorio y no puede estar vacío" });
    }

    const applied = [];
    const skipped = [];
    for (const clientId of clientIds) {
      // Transversal: cualquier scope de relación activa con ESTE profesional basta.
      const relation = await trainerClientDao.findActiveByTrainerAndClient(req.auth.userId, clientId);
      if (!relation) {
        skipped.push(clientId);
        continue;
      }
      await checkinDao.applyToClient(req.auth.userId, clientId, definition);
      await notificationDao.create(clientId, req.auth.userId, "checkin_requested", {
        templateName: definition.name,
      });
      applied.push(clientId);
    }

    return res.send({ applied, skipped });
  },

  // GET /trainer/clients/:clientId/checkin-config — profesional, config ya aplicada
  async getClientCheckinConfig(req, res) {
    const config = await checkinDao.getAppliedConfig(req.auth.userId, req.params.clientId);
    return res.send(config);
  },

  // GET /trainer/clients/:clientId/checkin-responses — profesional, histórico
  async getClientCheckinResponses(req, res) {
    const responses = await checkinDao.listResponses(req.auth.userId, req.params.clientId);
    return res.send(responses);
  },

  // --- Lado cliente ---
  // GET /trainer/checkins/mine — qué campos le piden, por cada profesional con relación activa
  async listMine(req, res) {
    const configs = await checkinDao.getAppliedConfigsForClient(req.auth.userId);
    const activeTrainerIds = new Set();
    for (const config of configs) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(config.trainerId, req.auth.userId);
      if (relation) activeTrainerIds.add(String(config.trainerId));
    }
    const visible = configs.filter((c) => activeTrainerIds.has(String(c.trainerId)));

    const trainerIds = [...new Set(visible.map((c) => String(c.trainerId)))];
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    return res.send(
      visible.map((c) => ({ ...c, trainer: trainersById.get(String(c.trainerId)) || null }))
    );
  },

  // GET /trainer/checkins/mine/history — coach-tab FASE2, "formularios
  // completados": histórico de TODAS las respuestas del cliente, de
  // cualquier profesional con relación activa. Solo cubre respuestas con
  // algún campo "wellbeing" (incluido el nuevo "comment") — las respuestas
  // puramente de composición corporal/perímetros no generan CheckinResponse
  // (ver checkin-dao.js, van a Anthropometry), así que no aparecen aquí.
  async listMyHistory(req, res) {
    const clientId = req.auth.userId;
    const configs = await checkinDao.getAppliedConfigsForClient(clientId);
    const activeTrainerIds = new Set();
    for (const config of configs) {
      const relation = await trainerClientDao.findActiveByTrainerAndClient(config.trainerId, clientId);
      if (relation) activeTrainerIds.add(String(config.trainerId));
    }

    const trainerIds = [...activeTrainerIds];
    const trainers = await userSchema.find({ _id: { $in: trainerIds } }).select("name lastname").lean();
    const trainersById = new Map(trainers.map((t) => [String(t._id), t]));

    const allResponses = [];
    for (const trainerId of trainerIds) {
      const responses = await checkinDao.listResponses(trainerId, clientId);
      for (const response of responses) {
        allResponses.push({ ...response, trainer: trainersById.get(trainerId) || null });
      }
    }
    allResponses.sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt));

    return res.send(allResponses);
  },

  // POST /trainer/checkins/:trainerId/respond
  async respond(req, res) {
    const clientId = req.auth.userId;
    const trainerId = req.params.trainerId;

    const relation = await trainerClientDao.findActiveByTrainerAndClient(trainerId, clientId);
    if (!relation) {
      return res.status(403).send({ message: "No tienes una relación activa con este profesional" });
    }

    const config = await checkinDao.getAppliedConfig(trainerId, clientId);
    const enabledFields = new Set(config?.enabledFields || []);

    const values = req.body?.values || {};
    const submittedKeys = Object.keys(values);

    for (const key of submittedKeys) {
      if (!enabledFields.has(key)) {
        return res.status(400).send({
          message: `El campo "${key}" no está activo para este check-in`,
          code: "CHECKIN_FIELD_NOT_ACTIVE",
        });
      }
      const fieldDef = CHECKIN_FIELDS_BY_KEY.get(key);
      const value = values[key];
      if (fieldDef.type === "scale_1_5" && (value < 1 || value > 5)) {
        return res.status(400).send({ message: `"${key}" debe estar entre 1 y 5` });
      }
      if (fieldDef.type === "number" && value < 0) {
        return res.status(400).send({ message: `"${key}" no puede ser negativo` });
      }
      if (fieldDef.type === "text") {
        if (typeof value !== "string" || !value.trim()) {
          return res.status(400).send({ message: `"${key}" es obligatorio y debe ser texto` });
        }
        if (value.length > 1000) {
          return res.status(400).send({ message: `"${key}" no puede superar 1000 caracteres` });
        }
        values[key] = value.trim();
      }
    }

    const anthropometryFields = {};
    const wellbeingValues = {};
    for (const key of submittedKeys) {
      const fieldDef = CHECKIN_FIELDS_BY_KEY.get(key);
      if (fieldDef.storage === "anthropometry") {
        anthropometryFields[fieldDef.anthropometryField] = values[key];
      } else {
        wellbeingValues[key] = values[key];
      }
    }

    let anthropometryDoc = null;
    if (Object.keys(anthropometryFields).length) {
      anthropometryDoc = await anthropometryDao.mergeAnthropometryFields(
        clientId,
        todayIsoDate(),
        anthropometryFields
      );
    }

    let responseDoc = null;
    if (Object.keys(wellbeingValues).length) {
      responseDoc = await checkinDao.createResponse(trainerId, clientId, wellbeingValues);
    }

    return res.status(201).send({ anthropometry: anthropometryDoc, response: responseDoc });
  },
};
