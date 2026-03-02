const setModel = require("./set-service");

module.exports = {
  async getSetById(req, res) {
    const set = await setModel.getSetById(req.params.id);
    return res.send(set);
  },

  async createSet(req, res) {
    const set = await setModel.createSet(req.body);
    return res.send(set);
  },
  async createSets(req, res) {
    const sets = await setModel.createSets(req.body);
    return res.send(sets);
  },

  async updateSet(req, res) {
    const set = await setModel.updateSet(req.body);
    return res.send(set);
  },

  async deleteById(req, res) {
    await setModel.deleteSet(req.params.id);
    res.sendStatus(204);
  },
};
