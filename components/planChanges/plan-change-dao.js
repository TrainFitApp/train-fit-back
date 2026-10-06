const PlanChange = require("./plan-change-schema");

// Historial de cambios de lo pautado a un cliente (plan-change-service.js).
module.exports = {
  create: (data) => PlanChange.create(data),

  listForClient(trainerId, clientId, { entity, limit }) {
    const filter = { trainerId, clientId };
    if (entity) filter.entity = entity;
    return PlanChange.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  },
};
