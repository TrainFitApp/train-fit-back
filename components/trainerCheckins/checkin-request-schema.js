const mongoose = require("mongoose");
const { CustomCheckinQuestionSchema } = require("./checkin-custom-question");
const schema = new mongoose.Schema({
  trainerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: "CheckinSchedule", required: true },
  occurrenceKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  enabledFields: [String],
  customQuestions: { type: [CustomCheckinQuestionSchema], default: [] },
  scheduledAt: { type: Date, required: true },
  closesAt: { type: Date, default: null },
  timeZone: { type: String, required: true },
  manual: { type: Boolean, default: false },
  status: { type: String, enum: ["pending", "unanswered", "responded", "reviewed", "cancelled"], default: "pending" },
  values: { type: mongoose.Schema.Types.Mixed, default: {} },
  respondedAt: { type: Date, default: null },
  reviewedAt: { type: Date, default: null },
  reviewComment: { type: String, default: "", maxlength: 2000 },
  seenByTrainer: { type: Boolean, default: false },
  notificationQueuedAt: { type: Date, default: null },
  projectedAt: { type: Date, default: null },
  anthropometryProjectedAt: { type: Date, default: null },
}, { collection: "checkinrequests", timestamps: true });
schema.index({ trainerId: 1, clientId: 1, scheduledAt: -1 });
schema.index({ clientId: 1, status: 1, closesAt: 1 });
module.exports = mongoose.model("CheckinRequest", schema);
