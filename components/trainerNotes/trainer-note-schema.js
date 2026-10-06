const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const TrainerNoteSchema = new Schema({
  trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  text: { type: String, required: true, trim: true, maxlength: 2000 },
  pinned: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
}, { collection: "trainernotes" });

TrainerNoteSchema.index({ trainerId: 1, clientId: 1, createdAt: -1 });

TrainerNoteSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId", "clientId"] });

module.exports = mongoose.model("TrainerNote", TrainerNoteSchema);
