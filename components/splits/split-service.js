const splitDao = require("./split-dao");

module.exports = {
  async getSplit(id) {
    return splitDao.getSplit(id);
  },

  async addSplitToTable(idTable, idSplit, withSets) {
    return splitDao.addSplitToTable(idTable, idSplit, withSets);
  },

  async updateSplit(id, split) {
    return splitDao.updateSplit(id, split);
  },

  async reorderSplits(idTable, splitIdsOrder) {
    return splitDao.reorderSplits(idTable, splitIdsOrder);
  },

  async createBlankSplitAndAddToTable(idTable, name) {
    return splitDao.createBlankSplitAndAddToTable(idTable, name);
  },

  async deleteSplit(idTable, idSplit) {
    return splitDao.deleteSplit(idTable, idSplit);
  },

  async deleteSplits(idTable, splitIds, userId, workoutInUse) {
    return splitDao.deleteSplits(idTable, splitIds, userId, workoutInUse);
  },
};
