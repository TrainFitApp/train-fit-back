const mongoose = require("mongoose");
const { CustomCheckinQuestionSchema } = require("./checkin-custom-question");
const schema = new mongoose.Schema({
  trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true, maxlength: 100 },
  sourceTemplateId: { type: mongoose.Schema.Types.ObjectId, default: null },
  legacyConfigId: { type: mongoose.Schema.Types.ObjectId, default: null },
  enabledFields: [String],
  requiredFields: { type: [String], default: [] },
  customQuestions: { type: [CustomCheckinQuestionSchema], default: [] },
  startDate: { type: String, required: true },
  time: { type: String, required: true },
  timeZone: { type: String, required: true },
  frequency: { type: String, enum: ["once", "daily", "weekly", "monthly"], required: true },
  interval: { type: Number, min: 1, max: 52, default: 1 },
  active: { type: Boolean, default: true },
  nextRunAt: { type: Date, default: null },
  revision: { type: Number, default: 0 },
  leaseUntil: { type: Date, default: null },
  leaseToken: { type: String, default: null },
}, { collection: "checkinschedules", timestamps: true });
schema.index({ trainerId: 1, clientId: 1 });
schema.index({ active: 1, nextRunAt: 1 });
schema.index({ legacyConfigId: 1 }, { unique: true, partialFilterExpression: { legacyConfigId: { $type: "objectId" } } });
module.exports = mongoose.model("CheckinSchedule", schema);
