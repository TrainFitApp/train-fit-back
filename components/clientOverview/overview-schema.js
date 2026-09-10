const mongoose = require("mongoose");
const { Schema } = mongoose;
const stageSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, required: true }, clientId: { type: Schema.Types.ObjectId, required: true },
  key: { type: String, required: true }, relationIds: [Schema.Types.ObjectId],
  startedAt: Date, endedAt: { type: Date, default: null }, startEstimated: { type: Boolean, default: false },
  legacy: { type: Boolean, default: false },
  intakeSnapshot: { type: Schema.Types.Mixed, default: null },
  currentContext: { type: Schema.Types.Mixed, default: {} },
  baselines: { type: [Schema.Types.Mixed], default: [] }, measurementFields: { type: [String], default: [] },
  highlightedPerimeters: { type: [String], default: ["waist", "hip"] },
  version: { type: Number, default: 0 }, updatedBy: Schema.Types.ObjectId,
  changes: { type: [Schema.Types.Mixed], default: [] },
  submission: { type: Schema.Types.Mixed, default: null },
  completedRequests: { type: [String], default: [] },
}, { collection: "coachingstages", timestamps: true });
stageSchema.index({ trainerId: 1, clientId: 1, key: 1 }, { unique: true });
stageSchema.index({ trainerId: 1, clientId: 1, startedAt: -1 });
const reviewSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, required: true }, clientId: { type: Schema.Types.ObjectId, required: true },
  stageId: { type: Schema.Types.ObjectId, required: true }, requestId: { type: String, required: true },
  conclusion: { type: String, required: true, maxlength: 4000 }, nextStep: { type: String, default: "", maxlength: 2000 },
  linkedTaskId: { type: Schema.Types.ObjectId, default: null }, correctsReviewId: { type: Schema.Types.ObjectId, default: null },
  observedFingerprint: { type: String, required: true }, observedAt: { type: Date, required: true },
}, { collection: "clientoverviewreviews", timestamps: true });
reviewSchema.index({ trainerId: 1, clientId: 1, stageId: 1, requestId: 1 }, { unique: true });
reviewSchema.index({ trainerId: 1, clientId: 1, stageId: 1, createdAt: -1 });
const auditSchema = new Schema({ trainerId: Schema.Types.ObjectId, clientId: Schema.Types.ObjectId, stageId: Schema.Types.ObjectId, kind: String, before: Schema.Types.Mixed, after: Schema.Types.Mixed }, { collection: "clientoverviewaudits", timestamps: true });
module.exports = {
  CoachingStage: mongoose.models.CoachingStage || mongoose.model("CoachingStage", stageSchema),
  OverviewReview: mongoose.models.OverviewReview || mongoose.model("OverviewReview", reviewSchema),
  OverviewAudit: mongoose.models.OverviewAudit || mongoose.model("OverviewAudit", auditSchema),
};
