const dietTemplateService = require("./diet-template-service");
const { rejectIfReadOnly } = require("../trainerClients/trainer-seat-service");
const { badRequest } = require("../util/http-error");

// Solo un admin puede marcar una plantilla como "de fábrica" (verified), mismo
// criterio que recipe-controller.js#isAdmin.
function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

function requiredName(value) {
  const name = (value || "").toString().trim();
  if (!name) throw badRequest("El nombre es obligatorio");
  return name;
}

module.exports = {
  // POST /trainer/diet-templates — body: { name, menus, ownerClientId?, verified? }
  async createTemplate(req, res) {
    const ownerClientId = req.body?.ownerClientId || null;
    // Colgarla de un cliente en solo lectura (por encima del cupo) es
    // modificar su ficha: mismo bloqueo que el resto de escrituras.
    if (ownerClientId && (await rejectIfReadOnly(req, res, ownerClientId))) return;
    const template = await dietTemplateService.create(req.auth.userId, {
      name: requiredName(req.body?.name),
      menus: req.body?.menus,
      ownerClientId,
      verified: isAdmin(req) && req.body?.verified === true,
    });
    return res.status(201).send(template);
  },

  // GET /trainer/diet-templates — sin parámetros, solo las generales.
  // ?forClientId=<id>[&onlyOwned=true] acota a ese cliente; ?includeOwned=true
  // las devuelve todas (la biblioteca).
  async listTemplates(req, res) {
    return res.send(
      await dietTemplateService.list(req.auth.userId, {
        forClientId: req.query?.forClientId || null,
        onlyOwned: req.query?.onlyOwned === "true",
        includeOwned: req.query?.includeOwned === "true",
      })
    );
  },

  // GET /trainer/diet-templates/:id
  async getTemplate(req, res) {
    return res.send(await dietTemplateService.getReadable(req.auth.userId, req.params.id));
  },

  // PUT /trainer/diet-templates/:id — body: { name?, menus?, suitableForOverride?, verified? }
  // El array derivado (suitableFor) nunca se acepta del body: lo recalcula el DAO.
  async updateTemplate(req, res) {
    const patch = {};
    if (req.body?.name !== undefined) patch.name = requiredName(req.body.name);
    if (req.body?.menus !== undefined) patch.menus = req.body.menus;
    if (Array.isArray(req.body?.suitableForOverride)) patch.suitableForOverride = req.body.suitableForOverride;
    if (isAdmin(req) && typeof req.body?.verified === "boolean") patch.verified = req.body.verified;
    return res.send(await dietTemplateService.update(req.auth.userId, req.params.id, patch));
  },

  // DELETE /trainer/diet-templates/:id
  async deleteTemplate(req, res) {
    await dietTemplateService.delete(req.auth.userId, req.params.id);
    return res.sendStatus(204);
  },
};
