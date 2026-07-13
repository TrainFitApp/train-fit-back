const nutritionalGoalDao = require("./nutritional-goal-dao");

module.exports = {
  async create(data) {
    return nutritionalGoalDao.create(data);
  },

  async getById(id) {
    return nutritionalGoalDao.findById(id);
  },

  async getByUserId(userId) {
    return nutritionalGoalDao.findByUserId(userId);
  },

  async update(id, data) {
    return nutritionalGoalDao.update(id, data);
  },

  async remove(id) {
    return nutritionalGoalDao.delete(id);
  },
};
