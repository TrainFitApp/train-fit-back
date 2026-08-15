const onboardingService = require("./onboarding-service");

module.exports = {
  async complete(req, res) {
    const key = typeof req.body?.key === "string" ? req.body.key : null;
    if (!key) {
      return res.status(400).send({ message: "key requerido" });
    }
    return res.send(await onboardingService.completeTutorial(req.user._id, key));
  },

  async reopen(req, res) {
    const key = typeof req.body?.key === "string" ? req.body.key : null;
    if (!key) {
      return res.status(400).send({ message: "key requerido" });
    }
    return res.send(await onboardingService.reopenTutorial(req.user._id, key));
  },
};
