const userSchema = require("../users/schema");
const featureAccessService = require("../billing/feature-access-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

module.exports = {
  // Solo lectura — funcionalidad 16. Sin endpoint de "comprar", el MVP es
  // un placeholder consciente sin integración de pago real.
  async getMine(req, res) {
    const trainer = await userSchema.findById(req.user.id).select("professionalPremium");
    const activeCount = await trainerClientDao.countActiveUniqueClients(req.user.id);
    return res.send(featureAccessService.buildTrainerEntitlements(trainer, activeCount));
  },
};
