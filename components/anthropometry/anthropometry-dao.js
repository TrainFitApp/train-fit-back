const mongoose = require("mongoose");
const anthropometrySchema = require("./anthropometry-schema");

const Anthropometry =
  mongoose.models.Anthropometry ||
  mongoose.model("Anthropometry", anthropometrySchema);

module.exports = {
  async createAnthropometry(data) {
    return Anthropometry.create(data);
  },

  async getAnthropometryById(id) {
    return Anthropometry.findById(id).lean();
  },

  async getAnthropometryByUserIdAndDate(userId, date) {
    return Anthropometry.findOne({ userId, date }).lean();
  },

  async getAnthropometriesByUserIdBetweenDates(userId, minDate, maxDate) {
    return Anthropometry.find({
      userId,
      date: { $gte: minDate, $lte: maxDate },
    })
      .sort({ date: -1 })
      .lean();
  },

  async getAllAnthropometriesByUserId(userId) {
    return Anthropometry.find({ userId }).sort({ date: -1 }).lean();
  },

  // Fase 1 Coach Pro — la ventana de análisis de TODOS los clientes de un
  // profesional en UNA consulta, no una por cliente. El evaluador nocturno
  // de alertas necesita 28 días de medidas de 30 clientes: con
  // getAnthropometriesByUserIdBetweenDates serían 30 idas y vueltas a Mongo
  // por cada profesional. El índice { userId: 1, date: -1 } cubre este
  // $in + $gte igual que cubre la consulta de un solo usuario.
  // Orden ASC (no DESC como el resto de este DAO) porque el cálculo de
  // tendencias recorre la serie cronológicamente.
  async listForUsersSince(userIds, sinceDate) {
    if (!userIds?.length) return [];
    return Anthropometry.find({
      userId: { $in: userIds },
      date: { $gte: sinceDate },
    })
      .sort({ date: 1 })
      .lean();
  },

  // Corregido (MVP-trainers F17, 2026-08-01): un `update` sin operador `$`
  // top-level es tratado por MongoDB como REEMPLAZO del documento entero, no
  // como actualización parcial — cualquier caller que enviara solo un
  // subconjunto de campos borraría silenciosamente el resto. Los callers
  // existentes siempre mandaban el objeto completo (por eso no se detectó
  // antes), pero `mergeAnthropometryFields` de abajo (usado por el check-in
  // de F17) sí manda subconjuntos, así que este `$set` es obligatorio.
  async updateAnthropometry(id, data) {
    return Anthropometry.findByIdAndUpdate(id, { $set: data }, { new: true }).lean();
  },

  async deleteAnthropometry(id) {
    return Anthropometry.findByIdAndDelete(id);
  },

  // MVP-trainers F17 — upsert atómico que SOLO toca los campos presentes en
  // `fields`, nunca sobrescribe el documento entero. Usado por el check-in
  // del profesional para fusionar con lo que el cliente ya haya auto-registrado
  // ese mismo día (o viceversa) sin que una escritura borre a la otra.
  async mergeCheckinFields(userId, date, fields, requestId) {
    try {
      return await Anthropometry.findOneAndUpdate(
        { userId, date, checkinSources: { $ne: requestId } },
        { $set: fields, $setOnInsert: { userId, date }, $addToSet: { checkinSources: requestId } },
        { new: true, upsert: true }
      ).lean();
    } catch (error) {
      // La clave única del día también protege el reintento tras una caída.
      if (error.code !== 11000 || !await Anthropometry.exists({ userId, date, checkinSources: requestId })) throw error;
      return null;
    }
  },

  async mergeAnthropometryFields(userId, date, fields) {
    return Anthropometry.findOneAndUpdate(
      { userId, date },
      { $set: fields, $setOnInsert: { userId, date } },
      { new: true, upsert: true }
    ).lean();
  },
};
