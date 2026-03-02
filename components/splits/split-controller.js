const splitService = require("./split-service");
const splitDTO = require("./split-dto");

module.exports = {
  async getSplits(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const splits = await splitService.getSplits(page, limit);
    return res.send(splits);
  },

  async getSplitByCode(req, res) {
    const split = await splitService.getSplitByCode(req.params.barcode);
    return res.send(split);
  },

  async getSplitsCount(req, res) {
    const count = await splitService.getSplitsCount();
    return res.send({ splitsCount: count });
  },

  async getSearchSplit(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const splits = await splitService.getSearchSplit(
      page,
      limit,
      req.params.search
    );
    return res.send(splits);
  },

  async createSplit(req, res) {
    const split = await splitService.createSplit(req.body);
    return res.send(split);
    // return res.send(splitDTO.single(split, req.body));
  },
  async createSplitAndAddToTable(req, res) {
    const split = await splitService.createSplitAndAddToTable(
      req.params.tableInUseId
    );
    return res.send(split);
    // return res.send(splitDTO.single(split, req.body));
  },
  async arhiveSplit(req, res) {
    await splitService.arhiveSplit(req.body.idUser, req.body.idSplit);
    return res.sendStatus(204);
  },

  async addSplitToTable(req, res) {
    const splitDoc = await splitService.addSplitToTable(req.body.idTable, req.body.idSplit, req.body.withSets);
    return res.send(splitDoc);
    // return res.send(splitDTO.single(split, req.body));
  },

  async addTableSplit(req, res) {
    const table = await splitService.addTableSplit(
      req.params.idTable,
      req.params.idSplit
    );

    return res.send(table);
  },

  async addWorkoutsSplit(req, res) {
    const split = await splitService.addWorkoutsSplit(
      req.params.idSplit,
      req.params.idWorkout
    );

    return res.send(split);
  },

  async updateSplit(req, res) {
    const split = await splitService.getSplit(req.params.id);
    if (!split) return res.sendStatus(404);

    await splitService.updateSplit(req.params.id, req.body);

    return res.sendStatus(204);
  },

  async deleteSplit(req, res) {
    await splitService.deleteSplit(req.params.idTable, req.params.idSplit);
    res.sendStatus(204);
  },
};
