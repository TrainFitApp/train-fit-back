const tutorialService = require("./tutorial-service");

module.exports = {
  async getAll(req, res) {
    return res.send(await tutorialService.getAll());
  },
};
