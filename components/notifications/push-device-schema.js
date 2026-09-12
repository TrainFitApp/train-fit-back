const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  sessionId: { type: String, required: true },
  platform: { type: String, enum: ["android", "ios"], required: true },
  token: { type: String, required: true, maxlength: 4096 },
}, { collection: "pushdevices", timestamps: true });
schema.index({ platform: 1, token: 1 }, { unique: true });
module.exports = mongoose.model("PushDevice", schema);
