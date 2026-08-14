const splitDao = require("./split-dao");
const splitUtil = require("./split-util");
const workoutUtil = require("../workouts/workout-util");
const tableService = require("../tables/table-service");
const workoutService = require("../workouts/workout-service");
const splitSchema = require("./split-schema");
const tableSchema = require("../tables/table-schema");

module.exports = {
  async getSplits(page, limit) {
    return splitDao.getSplits(page, limit);
  },

  async getSplitByCode(barcode) {
    return splitDao.getSplitByCode(barcode);
  },

  async getSplitsCount() {
    return splitDao.getSplitsCount();
  },

  async getSearchSplit(page, limit, search) {
    return splitDao.getSearchSplit(page, limit, search);
  },

  async getSplit(id) {
    return splitDao.getSplit(id);
  },

  async createSplit(split) {
    return splitDao.createSplit(split);
  },

  // TODO: no se utiliza de momento
  async createSplitAndAddToTable(tableInUseId) {
    const standardWorkout = workoutUtil.getStandarWorkout();
    const tableInUse = await tableService.getTableById(tableInUseId);

    let split;
    let workout;

    if (tableInUse.splits.length > 0) split = tableInUse.splits[0];
    else split = splitUtil.getStandarSplit();

    if (split.workouts.length === 0) {
      workout = await workoutService.createWorkout(standardWorkout);
      split.workouts.push(workout);
    }

    split = await splitSchema.create(split);

    const addSplitToTable = {
      $push: { splits: split._id },
    };

    return await tableSchema.findByIdAndUpdate(
      tableInUse._id,
      addSplitToTable,
      { new: true },
    );
  },

  async addSplitToTable(idTable, idSplit, withSets) {
    return splitDao.addSplitToTable(idTable, idSplit, withSets);
  },

  async addTableSplit(idTable, idSplit) {
    return splitDao.addTableSplit(idTable, idSplit);
  },

  async addWorkoutsSplit(idSplit, idWorkout) {
    return splitDao.addWorkoutsSplit(idSplit, idWorkout);
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
