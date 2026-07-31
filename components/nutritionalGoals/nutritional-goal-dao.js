const mongoose = require("mongoose");
const NutritionalGoal = require("./nutritional-goal-schema");

module.exports = {
  async create(data) {
    return NutritionalGoal.create(data);
  },

  async findById(id) {
    return NutritionalGoal.findById(id).lean();
  },

  async findByIdAndUserId(id, userId) {
    return NutritionalGoal.findOne({ _id: id, userId }).lean();
  },

  async findByUserId(userId) {
    return NutritionalGoal.find({ userId }).sort({ createdAt: -1 }).lean();
  },

  async findLatestByUserId(userId) {
    return NutritionalGoal.findOne({ userId }).sort({ createdAt: -1 }).lean();
  },

  async countByUserId(userId) {
    return NutritionalGoal.countDocuments({ userId });
  },

  // MVP-trainers D10: solo objetivos SIN assignedByTrainerId — ver
  // nutritional-goal-service.js#countEffectiveUserGoals.
  async countOwnByUserId(userId) {
    return NutritionalGoal.countDocuments({ userId, assignedByTrainerId: null });
  },

  async update(id, data) {
    return NutritionalGoal.findByIdAndUpdate(
      id,
      { ...data, updatedAt: new Date() },
      { new: true }
    ).lean();
  },

  async updateByUserId(id, userId, data) {
    return NutritionalGoal.findOneAndUpdate(
      { _id: id, userId },
      { ...data, updatedAt: new Date() },
      { new: true }
    ).lean();
  },

  async delete(id) {
    return NutritionalGoal.findByIdAndDelete(id);
  },

  async deleteByIdAndUserId(id, userId) {
    return NutritionalGoal.findOneAndDelete({ _id: id, userId }).lean();
  },

  async deleteByUserId(userId) {
    return NutritionalGoal.deleteMany({ userId });
  },
};
