const checkinDao = require("./checkin-dao");
const { CHECKIN_FIELDS, CHECKIN_FIELDS_BY_KEY } = require("./checkin-field-catalog");
const trainerClientAccess = require("../trainerClients/trainer-client-access");
const anthropometryService = require("../anthropometry/anthropometry-service");
const notificationService = require("../notifications/notification-service");

function makeError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const CHECKIN_DUE_DAYS = { weekly: 7, biweekly: 14 };

// Punto único de "¿toca check-in?" — reutilizado por el cron de
// recordatorio (este milestone) y por el dashboard del trainer cuando se
// construya (funcionalidad 14, M8). `responses` debe venir ya ordenado desc
// por respondedAt (listResponses ya lo hace).
function isCheckinDue(config, responses) {
  const lastResponse = responses[0];
  if (config.cadence === "once") return !lastResponse;
  const cadenceDays = CHECKIN_DUE_DAYS[config.cadence] || 7;
  if (!lastResponse) return true;
  const elapsedDays = (Date.now() - new Date(lastResponse.respondedAt).getTime()) / 86400000;
  return elapsedDays >= cadenceDays;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = {
  isCheckinDue,
  CHECKIN_DUE_DAYS,

  getFieldCatalog() {
    return CHECKIN_FIELDS;
  },

  async listDefinitions(trainerId) {
    return checkinDao.listDefinitions(trainerId);
  },

  async createDefinition(trainerId, { name, enabledFields, cadence }) {
    if (!name || !name.trim()) {
      throw makeError(400, "NAME_REQUIRED", "El nombre es obligatorio");
    }
    return checkinDao.createDefinition(trainerId, name.trim(), enabledFields || [], cadence);
  },

  async updateDefinition(trainerId, id, updates) {
    const definition = await checkinDao.updateDefinition(trainerId, id, updates);
    if (!definition) throw makeError(404, "DEFINITION_NOT_FOUND", "Plantilla no encontrada");
    return definition;
  },

  async deleteDefinition(trainerId, id) {
    const definition = await checkinDao.deleteDefinition(trainerId, id);
    if (!definition) throw makeError(404, "DEFINITION_NOT_FOUND", "Plantilla no encontrada");
    return definition;
  },

  // De uno o varios clientes a la vez — aplicar una plantilla de check-in sí
  // tiene sentido en bloque (a diferencia de dieta/objetivo/comida puntual,
  // funcionalidades 6/7/8, que son de uno en uno): es la misma config para
  // todos, sin personalización por cliente en el momento de aplicar.
  async applyDefinition(trainerId, definitionId, clientIds) {
    const definition = await checkinDao.getDefinitionById(trainerId, definitionId);
    if (!definition) throw makeError(404, "DEFINITION_NOT_FOUND", "Plantilla no encontrada");
    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      throw makeError(400, "CLIENT_IDS_REQUIRED", "clientIds es obligatorio y no puede estar vacío");
    }

    const applied = [];
    const skipped = [];
    for (const clientId of clientIds) {
      // Transversal: cualquier scope de relación activa con este trainer basta
      // (a diferencia de dieta/objetivo, que exigen scope "nutrition").
      const hasRelation =
        (await trainerClientAccess.hasActiveRelation(trainerId, clientId, "training")) ||
        (await trainerClientAccess.hasActiveRelation(trainerId, clientId, "nutrition"));
      if (!hasRelation) {
        skipped.push(clientId);
        continue;
      }
      await checkinDao.applyToClient(trainerId, clientId, definition);
      notificationService.notifyClient(clientId, trainerId, "checkin_requested", "TrainerCheckinTemplate", definitionId);
      applied.push(clientId);
    }

    return { applied, skipped };
  },

  // Transversal a cualquier scope activo, igual que applyDefinition — un
  // check-in no pertenece a training ni a nutrition en concreto.
  async requireAnyActiveRelation(trainerId, clientId) {
    const hasRelation =
      (await trainerClientAccess.hasActiveRelation(trainerId, clientId, "training")) ||
      (await trainerClientAccess.hasActiveRelation(trainerId, clientId, "nutrition"));
    if (!hasRelation) {
      throw makeError(403, "NO_ACTIVE_RELATION", "No hay una relación activa con este cliente");
    }
  },

  async getClientCheckinConfig(trainerId, clientId) {
    await this.requireAnyActiveRelation(trainerId, clientId);
    return checkinDao.getAppliedConfig(trainerId, clientId);
  },

  async getClientCheckinResponses(trainerId, clientId) {
    await this.requireAnyActiveRelation(trainerId, clientId);
    return checkinDao.listResponses(trainerId, clientId);
  },

  async listResponsesForTrainer(trainerId) {
    return checkinDao.listResponsesForTrainer(trainerId);
  },

  async getUnseenCount(trainerId) {
    const count = await checkinDao.countUnseenForTrainer(trainerId);
    return { count };
  },

  async markSeen(trainerId) {
    await checkinDao.markAllSeenForTrainer(trainerId);
    return { marked: true };
  },

  // --- Lado cliente ---

  async listMine(clientId) {
    const configs = await checkinDao.getAppliedConfigsForClient(clientId);
    const visible = [];
    for (const config of configs) {
      const hasRelation =
        (await trainerClientAccess.hasActiveRelation(config.trainerId, clientId, "training")) ||
        (await trainerClientAccess.hasActiveRelation(config.trainerId, clientId, "nutrition"));
      if (hasRelation) visible.push(config);
    }
    return visible;
  },

  async listMyHistory(clientId) {
    const configs = await this.listMine(clientId);
    const trainerIds = [...new Set(configs.map((c) => String(c.trainerId)))];
    const allResponses = [];
    for (const trainerId of trainerIds) {
      const responses = await checkinDao.listResponses(trainerId, clientId);
      allResponses.push(...responses);
    }
    allResponses.sort((a, b) => new Date(b.respondedAt) - new Date(a.respondedAt));
    return allResponses;
  },

  async respond(clientId, trainerId, values) {
    const hasRelation =
      (await trainerClientAccess.hasActiveRelation(trainerId, clientId, "training")) ||
      (await trainerClientAccess.hasActiveRelation(trainerId, clientId, "nutrition"));
    if (!hasRelation) {
      throw makeError(403, "NO_ACTIVE_RELATION", "No tienes una relación activa con este entrenador");
    }

    const config = await checkinDao.getAppliedConfig(trainerId, clientId);
    const enabledFields = new Set(config?.enabledFields || []);
    const submittedKeys = Object.keys(values || {});

    for (const key of submittedKeys) {
      if (!enabledFields.has(key)) {
        throw makeError(400, "CHECKIN_FIELD_NOT_ACTIVE", `El campo "${key}" no está activo para este check-in`);
      }
      const fieldDef = CHECKIN_FIELDS_BY_KEY.get(key);
      const value = values[key];
      if (fieldDef.type === "scale_1_5" && (value < 1 || value > 5)) {
        throw makeError(400, "INVALID_VALUE", `"${key}" debe estar entre 1 y 5`);
      }
      if (fieldDef.type === "number" && value < 0) {
        throw makeError(400, "INVALID_VALUE", `"${key}" no puede ser negativo`);
      }
      if (fieldDef.type === "text") {
        if (typeof value !== "string" || !value.trim()) {
          throw makeError(400, "INVALID_VALUE", `"${key}" es obligatorio y debe ser texto`);
        }
        if (value.length > 1000) {
          throw makeError(400, "INVALID_VALUE", `"${key}" no puede superar 1000 caracteres`);
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
      anthropometryDoc = await anthropometryService.upsertAnthropometry(
        clientId,
        todayIsoDate(),
        anthropometryFields
      );
    }

    let responseDoc = null;
    if (Object.keys(wellbeingValues).length) {
      responseDoc = await checkinDao.createResponse(trainerId, clientId, wellbeingValues);
    }

    return { anthropometry: anthropometryDoc, response: responseDoc };
  },
};
