const mongoose = require("mongoose");
const anthropometrySchema = require("./anthropometry-schema");

const Anthropometry = mongoose.model("Anthropometry", anthropometrySchema);

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

  async updateAnthropometry(id, data) {
    return Anthropometry.findByIdAndUpdate(id, data, { new: true }).lean();
  },

  async deleteAnthropometry(id) {
    return Anthropometry.findByIdAndDelete(id);
  },
};