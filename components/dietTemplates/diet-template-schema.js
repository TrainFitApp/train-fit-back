const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Plantilla de dieta secuencial (día 1..N que se repite) — funcionalidad 6.
// Reutiliza el Meal real (no un formato Mixed sin tipar), mismo patrón que
// Workout en las plantillas de rutina (funcionalidad 5): los Meal de una
// plantilla están desvinculados de cualquier DietDay de cliente, son
// propiedad del trainer, y se clonan en profundidad al aplicar.
const DietTemplateSchema = new Schema({
  trainerId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, trim: true, maxlength: 500 },
  days: [
    {
      dayLabel: { type: String, trim: true, maxlength: 100 },
      meals: [{ type: Schema.Types.ObjectId, ref: "Meal" }],
    },
  ],
});

module.exports = mongoose.model("DietTemplate", DietTemplateSchema);
