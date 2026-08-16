const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Perfil único del cliente (no por relación con un trainer concreto). Nace
// aquí con solo los 4 campos que comparte con el cuestionario inicial
// (funcionalidad 3); se amplía en M5 (funcionalidad 9) con franjas de
// comida desactivadas/renombradas y el flujo de "solicitar".
const ClientNutritionPreferencesSchema = new Schema({
  clientId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  allergies: { type: String, trim: true, maxlength: 1000 },
  favoriteFoods: { type: String, trim: true, maxlength: 1000 },
  dislikedFoods: { type: String, trim: true, maxlength: 1000 },
  cooksAtHome: {
    type: String,
    enum: ["yes", "no", "sometimes", null],
    default: null,
  },
  // Funcionalidad 9 — índices de MEALS (components/dietDays/diet-days-util.js,
  // 0=Desayuno..5=Recena) que el cliente desactiva, con renombres opcionales.
  disabledMealSlots: { type: [Number], default: undefined },
  mealSlotLabels: { type: Map, of: String, default: undefined },
  // Mecanismo de "solicitud" del trainer — dispara email ahora (el
  // Notification in-app de la funcionalidad 15 todavía no existe, M8).
  requestedAt: { type: Date, default: null },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  respondedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
});

ClientNutritionPreferencesSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model(
  "ClientNutritionPreferences",
  ClientNutritionPreferencesSchema
);
