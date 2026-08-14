const DietException = require("./diet-exception-schema");

module.exports = {
  async create({ assignmentId, clientId, date, mealSlot, action, override }) {
    return DietException.create({ assignmentId, clientId, date, mealSlot, action, override });
  },

  // Excepciones de una fecha exacta — puede haber varias si cada una afecta
  // a una comida distinta (mealSlot), o una sola con mealSlot:null para "todo
  // el día".
  async findForDate(clientId, date) {
    return DietException.find({ clientId, date });
  },

  // TASK-045 (MASTER_BACKLOG.md) — historial de nutrición del trainer: hasta
  // ahora no había ningún listado de excepciones por cliente, solo lectura
  // de una fecha exacta (findForDate, usado al resolver el día real).
  async findAllForClient(clientId, limit = 100) {
    return DietException.find({ clientId }).sort({ date: -1, createdAt: -1 }).limit(limit);
  },
};
