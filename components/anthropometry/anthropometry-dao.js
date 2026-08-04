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
  async mergeAnthropometryFields(userId, date, fields) {
    return Anthropometry.findOneAndUpdate(
      { userId, date },
      { $set: fields, $setOnInsert: { userId, date } },
      { new: true, upsert: true }
    ).lean();
  },
};