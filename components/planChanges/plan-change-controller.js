const planChangeService = require("./plan-change-service");

const LISTABLE_ENTITIES = ["nutritional_goal", "diet_plan", "routine", "checkin_config", "protocol"];

module.exports = {
  // GET /trainer/clients/:clientId/changes?entity=nutritional_goal
  // Protegido por requireActiveClient en la ruta.
  async listForClient(req, res) {
    const entity = LISTABLE_ENTITIES.includes(req.query.entity) ? req.query.entity : undefined;
    const changes = await planChangeService.listForClient(req.auth.userId, req.params.clientId, {
      entity,
    });
    return res.send(changes);
  },
};
