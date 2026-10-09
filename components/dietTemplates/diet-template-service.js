const dietTemplateDao = require("./diet-template-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { contentMacroProfile } = require("./diet-macro-profile");
const { sanitizeMenus } = require("./diet-menus");
const { forbidden, notFound } = require("../util/http-error");

// Biblioteca de plantillas de dieta del profesional (diet-template-schema.js).

const NOT_FOUND = "Plantilla no encontrada";

// Perfil de macros de un día tipo, para pintar las cards con kcal/P/C/G (mismo
// cálculo que el cajón de sugerencias, sin objetivo de cliente).
function withMacroProfile(template) {
  const doc = template.toObject ? template.toObject() : template;
  return { ...doc, macroProfile: contentMacroProfile(doc) };
}

// Una plantilla propia de un cliente, o la lista acotada a él, solo para
// clientes con relación activa: sin esto cualquier profesional podría colgar
// material de biblioteca del id de un cliente que no es suyo.
async function assertOwnClient(trainerId, clientId) {
  if (!(await trainerClientDao.isActivePair(trainerId, clientId))) throw forbidden("Ese cliente no es tuyo");
}

module.exports = {
  // `verified` (de fábrica) solo lo puede poner un admin: lo decide el
  // controller con el rol de la sesión.
  async create(trainerId, { name, menus, ownerClientId = null, verified = false }) {
    if (ownerClientId) await assertOwnClient(trainerId, ownerClientId);
    return dietTemplateDao.create(trainerId, {
      name,
      menus: sanitizeMenus(menus),
      ownerClientId,
      verified,
    });
  },

  async list(trainerId, { forClientId = null, onlyOwned = false, includeOwned = false } = {}) {
    if (forClientId) await assertOwnClient(trainerId, forClientId);
    const templates = await dietTemplateDao.listByTrainer(trainerId, { forClientId, onlyOwned, includeOwned });
    return templates.map(withMacroProfile);
  },

  // Una sola plantilla con su contenido completo. Lee también las de fábrica
  // de cualquiera (las que salen en el ranking), para la vista previa.
  async getReadable(trainerId, id) {
    const template = await dietTemplateDao.findReadableByTrainer(trainerId, id);
    if (!template) throw notFound(NOT_FOUND);
    return withMacroProfile(template);
  },

  // La que se va a aplicar a un cliente: las propias y las de fábrica (las
  // mismas que lista el cajón de sugerencias). Aplicar copia el contenido en
  // la fase del cliente: la plantilla de fábrica no se toca.
  async getApplicable(trainerId, id) {
    const template = await dietTemplateDao.findReadableByTrainer(trainerId, id);
    if (!template) throw notFound(NOT_FOUND);
    return template;
  },

  async update(trainerId, id, patch) {
    const template = await dietTemplateDao.update(trainerId, id, {
      ...patch,
      ...(patch.menus !== undefined ? { menus: sanitizeMenus(patch.menus) } : {}),
    });
    if (!template) throw notFound(NOT_FOUND);
    return template;
  },

  async delete(trainerId, id) {
    const result = await dietTemplateDao.delete(trainerId, id);
    if (!result.deletedCount) throw notFound(NOT_FOUND);
  },

  async listRankableForClient(trainerId, clientId, sources) {
    return dietTemplateDao.listRankableForClient(trainerId, clientId, sources);
  },
};
