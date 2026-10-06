const DietPhase = require("./diet-phase-schema");
const { mutateDocument } = require("../util/embedded-store");
const { CHAIN_SORT_DESC } = require("../util/phase-chain");

// Fases de dieta de los clientes (diet-phase-schema.js). El contenido va
// dentro; cambiarlo va con compare-and-swap sobre el documento (`mutate`).

// "Cubre `date`": empezó ese día o antes y no había acabado.
const coveringFilter = (clientId, date) => ({
  clientId,
  startDate: { $lte: date },
  $or: [{ endDate: null }, { endDate: { $gte: date } }],
});

module.exports = {
  async create(data) {
    const created = await DietPhase.create(data);
    // create() no autopuebla: se relee para devolver los alimentos poblados.
    return DietPhase.findById(created._id);
  },

  async findById(id) {
    return DietPhase.findById(id);
  },

  async findForClient(id, clientId) {
    return DietPhase.findOne({ _id: id, clientId });
  },

  // De la más reciente a la más antigua. `populate: false` para listados que
  // solo necesitan fechas y nombres.
  async listByClient(clientId, { populate = true } = {}) {
    const query = DietPhase.find({ clientId }).sort(CHAIN_SORT_DESC);
    return populate ? query : query.setOptions({ autopopulate: false }).lean();
  },

  // Con dos fases que empiezan el mismo día (se sustituye una el día en que
  // empezó: la vieja no puede acabar antes de empezar, así que se queda
  // cubriendo ese día), manda la más reciente.
  async findCoveringDate(clientId, date) {
    return DietPhase.findOne(coveringFilter(clientId, date)).sort(CHAIN_SORT_DESC);
  },

  // Las que tocan algún día de [from, to] (lista de la compra).
  async listCoveringRange(clientId, from, to) {
    return DietPhase.find({
      clientId,
      startDate: { $lte: to },
      $or: [{ endDate: null }, { endDate: { $gte: from } }],
    }).sort({ startDate: 1, createdAt: 1 });
  },

  /**
   * Fases cuyo rango se cruza con [startDate, endDate]. `endDate: null` es
   * "sin fin": una fase abierta solapa con todo lo que venga después. Dos
   * rangos se cruzan si cada uno empieza antes de que el otro acabe.
   */
  async findOverlapping(clientId, startDate, endDate, { excludeId } = {}) {
    const query = {
      clientId,
      ...(endDate ? { startDate: { $lte: endDate } } : {}),
      $or: [{ endDate: { $gte: startDate } }, { endDate: null }],
    };
    if (excludeId) query._id = { $ne: excludeId };
    return DietPhase.find(query).sort({ startDate: 1 });
  },

  // La última de la cadena (puede estar programada para más adelante).
  async findLatest(clientId, { populate = true } = {}) {
    const query = DietPhase.findOne({ clientId }).sort(CHAIN_SORT_DESC);
    return populate ? query : query.setOptions({ autopopulate: false }).lean();
  },

  // Fija el fin REAL de una fase (la corta otra, o vuelve a quedar abierta con
  // null).
  async setEndDate(id, endDate) {
    return DietPhase.findByIdAndUpdate(id, { $set: { endDate }, $inc: { __v: 1 } }, { new: true });
  },

  /**
   * Cambia la fase con compare-and-swap (util/embedded-store.js): `change`
   * recibe la fase en plano y devuelve los campos de primer nivel que
   * cambian, o null para no escribir. Devuelve la fase poblada, o null si no
   * existe.
   */
  async mutate(id, change) {
    const written = await mutateDocument(DietPhase, { _id: id }, change);
    return written ? DietPhase.findById(id) : null;
  },

  async deleteById(id) {
    return DietPhase.deleteOne({ _id: id });
  },

  // Borrado de la cuenta del entrenador (diet-phase-schema.js, cuando ya se
  // han borrado las fases de las que él era el cliente): las que pautó y ya
  // habían empezado se quedan como historial terminado del cliente (ayer
  // como último día, sin entrenador, sin las semanas que no llegaron a
  // correr); las que empiezan hoy o más adelante se borran. "Hoy" es el del
  // entrenador: un corte para toda su cartera de una vez.
  async releaseTrainerPhases(trainerId) {
    const { addDaysToIsoDate } = require("../util/date-util");
    const { todayForUser } = require("../users/user-time-zone");
    const yesterday = addDaysToIsoDate(await todayForUser(trainerId), -1);
    await DietPhase.deleteMany({ trainerId, startDate: { $gt: yesterday } });
    await DietPhase.updateMany({ trainerId }, [
      {
        $set: {
          trainerId: null,
          endDate: {
            $cond: [
              { $or: [{ $eq: [{ $ifNull: ["$endDate", null] }, null] }, { $gt: ["$endDate", yesterday] }] },
              yesterday,
              "$endDate",
            ],
          },
          contents: { $filter: { input: "$contents", cond: { $lte: ["$$this.startDate", yesterday] } } },
          __v: { $add: [{ $ifNull: ["$__v", 0] }, 1] },
        },
      },
    ]);
  },
};
