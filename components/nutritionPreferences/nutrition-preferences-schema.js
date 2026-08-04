const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const ClientNutritionPreferencesSchema = new Schema({
  clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  allergies: { type: String, default: "", trim: true, maxlength: 1000 },
  favoriteFoods: { type: String, default: "", trim: true, maxlength: 1000 },
  dislikedFoods: { type: String, default: "", trim: true, maxlength: 1000 },
  cooksAtHome: { type: String, enum: ["yes", "no", "sometimes", null], default: null },
  requestedAt: { type: Date, default: null },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  respondedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
}, { collection: "clientnutritionpreferences" });

module.exports = mongoose.model("ClientNutritionPreferences", ClientNutritionPreferencesSchema);
