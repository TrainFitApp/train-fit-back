const coachTaskDao = require("./coach-task-dao");

// Tareas del propio profesional (coach-task-schema.js), siempre filtradas
// por él.

module.exports = {
  create: (trainerId, data) => coachTaskDao.create(trainerId, data),
  createMany: (trainerId, items) => coachTaskDao.createMany(trainerId, items),
  listForTrainer: (trainerId, options) => coachTaskDao.listForTrainer(trainerId, options),
  update: (trainerId, id, updates) => coachTaskDao.update(trainerId, id, updates),
  remove: (trainerId, id) => coachTaskDao.remove(trainerId, id),
};
