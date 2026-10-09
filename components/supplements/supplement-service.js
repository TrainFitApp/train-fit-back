const supplementDao = require("./supplement-dao");
const userDao = require("../users/user-dao");
const trainerClientService = require("../trainerClients/trainer-client-service");
const { conflict, forbidden, notFound, onDuplicate } = require("../util/http-error");

// Suplementación que pauta el profesional a su cliente (supplement-schema.js)
// y la que se apunta el propio cliente (trainerId null).

// trainerId de los suplementos propios del cliente.
const OWN = null;
const OWN_DUPLICATE = (name) => onDuplicate(`Ya tienes "${name}". Edita el que tienes en vez de crear otro.`, "SUPPLEMENT_DUPLICATE");

module.exports = {
  listForClient: (trainerId, clientId) => supplementDao.listForClient(trainerId, clientId),

  async create(trainerId, clientId, data) {
    try {
      return await supplementDao.create(trainerId, clientId, data);
    } catch (error) {
      // 11000 = choque con el índice único {trainerId, clientId, name}: se
      // dice qué hacer en vez de un 500.
      if (error?.code === 11000) {
        throw conflict(`Ya le has pautado "${data.name}". Edita el que tienes en vez de crear otro.`, "SUPPLEMENT_DUPLICATE");
      }
      throw error;
    }
  },

  update: (trainerId, clientId, id, data) => supplementDao.update(trainerId, clientId, id, data),
  remove: (trainerId, clientId, id) => supplementDao.remove(trainerId, clientId, id),

  // --- Propios del cliente ---
  // Solo se añaden sin profesional activo: con uno, la suplementación la
  // pauta él. Los que ya tenía siguen siendo suyos y los puede editar y
  // quitar siempre.
  async createOwn(clientId, data) {
    if (await trainerClientService.hasActiveTrainer(clientId)) {
      throw forbidden("Tu profesional lleva tu suplementación: pídele que te lo paute.", "SUPPLEMENT_MANAGED_BY_TRAINER");
    }
    return supplementDao.create(OWN, clientId, data).catch(OWN_DUPLICATE(data.name));
  },

  async updateOwn(clientId, id, data) {
    const supplement = await supplementDao.update(OWN, clientId, id, data).catch(OWN_DUPLICATE(data.name));
    if (!supplement) throw notFound("Suplemento no encontrado", "SUPPLEMENT_NOT_FOUND");
    return supplement;
  },

  async removeOwn(clientId, id) {
    const { deletedCount } = await supplementDao.remove(OWN, clientId, id);
    if (!deletedCount) throw notFound("Suplemento no encontrado", "SUPPLEMENT_NOT_FOUND");
  },

  /**
   * Los del cliente vigentes en `date`: los que le pautó CUALQUIER
   * profesional con relación viva (de uno ya desvinculado no), cada uno con
   * quién se lo pautó —puede tener entrenador y nutricionista, y "tómate
   * esto" sin saber de quién viene no se sigue igual—, y después los suyos
   * (`own: true`).
   */
  async listActiveForClient(clientId, date) {
    const supplements = await supplementDao.listActiveForClient(clientId, date);
    const own = supplements.filter((s) => !s.trainerId).map((s) => ({ ...s, own: true }));
    const prescribed = await withActiveTrainers(clientId, supplements.filter((s) => s.trainerId));
    return [...prescribed, ...own];
  },
};

// Los pautados de profesionales con relación viva, con su nombre.
async function withActiveTrainers(clientId, supplements) {
  if (!supplements.length) return [];
  // Una comprobación por PROFESIONAL, no por suplemento.
  const trainerIds = [...new Set(supplements.map((s) => String(s.trainerId)))];
  const activeTrainerIds = new Set();
  for (const trainerId of trainerIds) {
    if (await trainerClientService.hasActiveClient(trainerId, clientId)) activeTrainerIds.add(trainerId);
  }
  const visible = supplements.filter((s) => activeTrainerIds.has(String(s.trainerId)));
  if (!visible.length) return [];

  const trainers = await userDao.listFields([...activeTrainerIds], "name lastname");
  const trainersById = new Map(trainers.map((t) => [String(t._id), t]));
  return visible.map((supplement) => {
    const trainer = trainersById.get(String(supplement.trainerId));
    return {
      ...supplement,
      own: false,
      trainerName: trainer ? `${trainer.name || ""} ${trainer.lastname || ""}`.trim() : "Tu profesional",
    };
  });
}
