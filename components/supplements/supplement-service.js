const supplementDao = require("./supplement-dao");
const userDao = require("../users/user-dao");
const trainerClientService = require("../trainerClients/trainer-client-service");
const { conflict } = require("../util/http-error");

// Suplementación que pauta el profesional a su cliente (supplement-schema.js).

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

  /**
   * Los del cliente vigentes en `date`, de CUALQUIER profesional con relación
   * viva (de uno ya desvinculado no), cada uno con quién se lo pautó: puede
   * tener entrenador y nutricionista, y "tómate esto" sin saber de quién
   * viene no se sigue igual.
   */
  async listActiveForClient(clientId, date) {
    const supplements = await supplementDao.listActiveForClient(clientId, date);
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
        trainerName: trainer ? `${trainer.name || ""} ${trainer.lastname || ""}`.trim() : "Tu profesional",
      };
    });
  },
};
