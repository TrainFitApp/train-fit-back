const setDao = require("./set-dao");

module.exports = {
  async createSet(set) {
    return setDao.createSet(set);
  },
  async createSets(sets) {
    return setDao.createSets(sets);
  },

  async updateSet(set) {
    return setDao.updateSet(set);
  },

  async deleteSet(id) {
    return setDao.deleteSet(id);
  },
};
