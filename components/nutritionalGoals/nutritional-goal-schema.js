const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Un objetivo nutricional del usuario (kcal y macros del día). Vive DENTRO
// del usuario (User.nutritionalGoals[]): son pocos por persona y el que rige
// lo marca User.goalInUse. Se leen y escriben solo por
// nutritional-goal-dao.js.
const NutritionalGoalSchema = new Schema(
  {
    name: { type: String, required: true, default: "Default", trim: true, maxlength: 100 },
    kcalTotal: { type: Number, default: 0 },
    proteinsGTotal: { type: Number, default: 0 },
    carbohydratesGTotal: { type: Number, default: 0 },
    fatGTotal: { type: Number, default: 0 },
    fiberGTotal: { type: Number, default: null },
    // "manual": alguien (el cliente o su profesional) fijó las cifras a mano
    // y recalcular desde el perfil no las pisa.
    source: { type: String, enum: ["calculated", "manual"], default: "calculated" },
    updatedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

// Campos que se pueden escribir en un objetivo.
const GOAL_FIELDS = Object.keys(NutritionalGoalSchema.paths).filter((path) => !["_id", "createdAt", "updatedAt"].includes(path));

module.exports = NutritionalGoalSchema;
module.exports.GOAL_FIELDS = GOAL_FIELDS;
