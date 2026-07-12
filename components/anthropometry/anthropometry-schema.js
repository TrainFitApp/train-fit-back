const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AnthropometrySchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  date: {
    type: String,
    required: true,
  },
  weight: { type: Number },
  neck: { type: Number },
  chest: { type: Number },
  bicepsRelaxed: { type: Number },
  bicepsContracted: { type: Number },
  waist: { type: Number },
  abdomen: { type: Number },
  hip: { type: Number },
  thighContracted: { type: Number },
  thighRelaxed: { type: Number },
  calf: { type: Number },
});

AnthropometrySchema.index({ userId: 1, date: -1 }, { unique: true });

module.exports = AnthropometrySchema;