const DietTemplate = require("./diet-template-schema");
const { deriveSuitability } = require("./diet-suitability");
const { rankableFilter, readableFilter } = require("./diet-source-filter");
const { materializeMenus } = require("./diet-menus");

const { DIETARY_FLAGS } = DietTemplate;

// `suitableFor` (vegana / sin gluten / ...) es DERIVADO del contenido, nunca
// tecleado: se recalcula tras cada alta o cambio de menús. Necesita el
// documento poblado (los alimentos con sus flags), por eso va en una segunda
// pasada; devuelve la plantilla ya poblada.
async function recomputeSuitability(id) {
  const doc = await DietTemplate.findById(id);
  if (!doc) return null;
  const { suitableFor } = deriveSuitability(doc.toObject());
  await DietTemplate.updateOne({ _id: id }, { $set: { suitableFor } });
  return DietTemplate.findById(id);
}

module.exports = {
  // Los menús llegan en crudo del constructor (ya saneados por
  // diet-menus.js#sanitizeMenus) y se guardan con ids nuevos.
  // `ownerClientId` puesto = plantilla propia de ese cliente; `verified` =
  // de fábrica (solo admin, lo decide el servicio).
  async create(trainerId, { name, menus, ownerClientId = null, verified = false }) {
    const created = await DietTemplate.create({
      trainerId,
      name,
      ownerClientId,
      verified,
      menus: await materializeMenus(menus),
    });
    return recomputeSuitability(created._id);
  },

  // La biblioteca del profesional. Por defecto SOLO las generales (lo que
  // esperan protocolos y selectores genéricos: aplicables a cualquiera).
  //
  // forClientId acota a un cliente, con las dos formas del selector de
  // "Siguiente fase":
  //   onlyOwned=true  -> SOLO las propias de ese cliente
  //   onlyOwned=false -> generales + las propias de ese cliente. Nunca las
  //                      propias de OTRO cliente.
  //
  // includeOwned las devuelve TODAS (la biblioteca, "Gestionar plantillas"):
  // si no, una dieta propia quedaría sin sitio donde volver a editarla.
  async listByTrainer(trainerId, { forClientId = null, onlyOwned = false, includeOwned = false } = {}) {
    const filter = { trainerId };
    if (forClientId) {
      filter.ownerClientId = onlyOwned ? forClientId : { $in: [forClientId, null] };
    } else if (!includeOwned) {
      filter.ownerClientId = null;
    }
    return DietTemplate.find(filter).sort({ createdAt: -1 });
  },

  async findOwnedByTrainer(trainerId, id) {
    return DietTemplate.findOne({ _id: id, trainerId });
  },

  // Solo lectura: las propias y las de fábrica de cualquiera (ver
  // diet-source-filter.js#readableFilter). Nunca para editar o aplicar.
  async findReadableByTrainer(trainerId, id) {
    return DietTemplate.findOne(readableFilter(trainerId, id));
  },

  // Sugerencias de dieta: las generales del profesional, las propias de este
  // cliente y las de fábrica de cualquiera. `sources` acota el origen
  // (diet-source-filter.js).
  async listRankableForClient(trainerId, clientId, sources) {
    return DietTemplate.find(rankableFilter(trainerId, clientId, sources)).sort({ createdAt: -1 });
  },

  async update(trainerId, id, { name, menus, suitableForOverride, verified }) {
    const set = {};
    if (name !== undefined) set.name = name;
    if (menus !== undefined) set.menus = await materializeMenus(menus);
    if (Array.isArray(suitableForOverride)) {
      set.suitableForOverride = suitableForOverride.filter((flag) => DIETARY_FLAGS.includes(flag));
    }
    if (typeof verified === "boolean") set.verified = verified;

    const result = await DietTemplate.updateOne({ _id: id, trainerId }, { $set: set });
    if (!result.matchedCount) return null;
    return recomputeSuitability(id);
  },

  async delete(trainerId, id) {
    return DietTemplate.deleteOne({ _id: id, trainerId });
  },
};
