const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TrainerNoteSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  pinned: { type: Boolean, default: false },
  stageId: { type: Schema.Types.ObjectId, ref: "CoachingStage", default: null },
  requestId: { type: String, default: undefined },
  version: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
  createdAt: { type: Date, default: Date.now },
}, { collection: "trainernotes" });

TrainerNoteSchema.index({ trainerId: 1, clientId: 1, createdAt: -1 });
TrainerNoteSchema.index({ trainerId: 1, clientId: 1, requestId: 1 }, { unique: true, partialFilterExpression: { requestId: { $type: "string" } } });

module.exports = mongoose.model("TrainerNote", TrainerNoteSchema);
