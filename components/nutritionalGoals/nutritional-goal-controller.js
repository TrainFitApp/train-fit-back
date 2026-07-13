const nutritionalGoalService = require("./nutritional-goal-service");

const controller = {
  async create(req, res) {
    const goal = await nutritionalGoalService.create({
      userId: req.user.id,
      name: req.body.name || "Default",
      kcalTotal: req.body.kcalTotal || 0,
      proteinsGTotal: req.body.proteinsGTotal || 0,
      carbohydratesGTotal: req.body.carbohydratesGTotal || 0,
      fatGTotal: req.body.fatGTotal || 0,
    });
    return res.send(goal);
  },

  async getById(req, res) {
    const goal = await nutritionalGoalService.getById(req.params.id);
    if (!goal) return res.sendStatus(404);
    return res.send(goal);
  },

  async getAllByUserId(req, res) {
    const goals = await nutritionalGoalService.getByUserId(req.user.id);
    return res.send(goals);
  },

  async update(req, res) {
    const goal = await nutritionalGoalService.update(req.params.id, {
      name: req.body.name,
      kcalTotal: req.body.kcalTotal,
      proteinsGTotal: req.body.proteinsGTotal,
      carbohydratesGTotal: req.body.carbohydratesGTotal,
      fatGTotal: req.body.fatGTotal,
    });
    if (!goal) return res.sendStatus(404);
    return res.send(goal);
  },

  async remove(req, res) {
    await nutritionalGoalService.remove(req.params.id);
    return res.sendStatus(204);
  },
};

module.exports = controller;
