const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase 4 Coach Pro — la metodología del coach, empaquetada (§20).
//
// "Definición", "Volumen", "Recomposición": cada coach tiene sus propios
// protocolos, y dar de alta a un cliente en uno significa hoy repetir cinco
// operaciones a mano (objetivo nutricional, plantilla de check-in, plan de
// dieta, rutina, tareas diarias) sin nada que garantice que no se olvida
// ninguna.
//
// Un protocolo NO es una entidad nueva de contenido: es una LISTA DE
// REFERENCIAS a lo que ya existe. Aplicarlo ejecuta exactamente las mismas
// operaciones individuales que el coach haría a mano (ver
// coach-protocol-service.js), nunca una vía paralela que pudiera divergir
// de ellas. Por eso aquí no hay ni una comida ni un ejercicio: solo ids.
const CoachProtocolSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: "" },

    // Los macros van copiados y no referenciados a propósito: NutritionalGoal
    // es un documento POR CLIENTE (userId obligatorio), así que un protocolo
    // no puede apuntar a uno — tiene que llevar los valores con los que
    // crear el del cliente al aplicarlo.
    nutritionalGoal: {
      kcalTotal: { type: Number, default: null },
      proteinsGTotal: { type: Number, default: null },
      carbohydratesGTotal: { type: Number, default: null },
      fatGTotal: { type: Number, default: null },
    },

    // El resto sí son plantillas del profesional, reutilizables tal cual.
    checkinTemplateId: { type: Schema.Types.ObjectId, ref: "CheckinTemplateDefinition", default: null },
    dietTemplateId: { type: Schema.Types.ObjectId, ref: "DietTemplate", default: null },
    routineTemplateId: { type: Schema.Types.ObjectId, ref: "Table", default: null },
    ruleIds: [{ type: Schema.Types.ObjectId, ref: "CoachRule" }],

    // Hábitos diarios (TrainerTask) que se crean para el cliente al aplicar.
    // Mismo shape que TrainerTask menos trainerId/clientId, que solo se
    // conocen al aplicar.
    dailyTasks: [
      {
        type: { type: String, enum: ["steps", "water", "sleep", "cardio", "custom"], required: true },
        label: { type: String, trim: true, maxlength: 100, default: null },
        target: { type: Number, required: true, min: 0 },
        unit: { type: String, required: true, trim: true, maxlength: 20 },
      },
    ],

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "coachprotocols" }
);

CoachProtocolSchema.index({ trainerId: 1, name: 1 }, { unique: true });

CoachProtocolSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("CoachProtocol", CoachProtocolSchema);
