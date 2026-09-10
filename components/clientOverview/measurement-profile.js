const mongoose = require("mongoose");
const { validTimeZone, civilToday } = require("./body-metrics");

const schema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  timeZone: { type: String, required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  source: { type: String, enum: ["client", "professional"], default: "client" },
}, { timestamps: true, collection: "clientmeasurementprofiles" });
const Model = mongoose.models.ClientMeasurementProfile || mongoose.model("ClientMeasurementProfile", schema);

async function getTimeZone(clientId) {
  const profile = await Model.findOne({ clientId }).select("timeZone").lean();
  return validTimeZone(profile?.timeZone) ? profile.timeZone : "UTC";
}

async function setTimeZone(clientId, timeZone, actorId = clientId, source = "client") {
  if (!validTimeZone(timeZone) || !["client", "professional"].includes(source)) {
    const error = new Error("La zona horaria no es válida"); error.status = 400; error.code = "INVALID_TIME_ZONE"; throw error;
  }
  await Model.findOneAndUpdate({ clientId }, { $set: { timeZone, updatedBy: actorId, source } }, { upsert: true, runValidators: true });
  return timeZone;
}

module.exports = { getTimeZone, setTimeZone, civilToday };
