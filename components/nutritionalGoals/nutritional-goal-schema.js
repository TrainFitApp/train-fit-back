const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Movimiento 5 Coach Pro — pauta por INTERCAMBIOS, repartida por comida.
//
// Convive con los gramos, no los sustituye (decisión explícita del usuario).
// Son dos formas de pautar lo mismo y cada entrenador usa la suya: los
// gramos dicen "180 g de proteína al día", los intercambios dicen "2
// raciones de proteína en la comida" y dejan que el cliente elija cuál. Un
// objetivo puede tener las dos, una, o ninguna.
//
// `count` en decimal a propósito: media ración es una pauta real ("medio
// intercambio de grasa en el desayuno") y forzar enteros la haría imposible.
const GoalMealExchangeSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "FoodExchangeGroup", required: true },
    // Nombre del grupo copiado en el momento de pautar. Igual que en
    // ExchangeItemSchema: si el grupo se renombra o se borra, la pauta que
    // el cliente ya tiene debe seguir siendo legible.
    groupName: { type: String, required: true, trim: true, maxlength: 100 },
    count: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const GoalMealSchema = new Schema(
  {
    // Nombre libre ("Desayuno", "Post-entreno"): cada entrenador reparte el
    // día a su manera, y un enum de cinco comidas dejaría fuera la mitad.
    name: { type: String, required: true, trim: true, maxlength: 60 },
    exchanges: { type: [GoalMealExchangeSchema], default: [] },
  },
  { _id: false }
);

const NutritionalGoalSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    default: "Default",
    trim: true,
    maxlength: 100,
  },
  kcalTotal: { type: Number, default: 0 },
  proteinsGTotal: { type: Number, default: 0 },
  carbohydratesGTotal: { type: Number, default: 0 },
  fatGTotal: { type: Number, default: 0 },
  // Fase 5 Coach Pro — "fibra si procede" (§15). `null` y no 0 a propósito:
  // un objetivo sin fibra definida no es "0 g de fibra", es que ese coach no
  // la pauta. Todo lo que ya existía sigue funcionando igual — el campo es
  // opcional y nada lo exige.
  fiberGTotal: { type: Number, default: null },
  // Movimiento 5 Coach Pro — reparto por comidas en intercambios. Array
  // vacío = este objetivo se pauta solo en gramos, que es exactamente lo que
  // hacían todos los objetivos hasta ahora. Nada existente cambia.
  mealExchanges: { type: [GoalMealSchema], default: [] },
  // MVP-trainers F13/F14/D10: presente si un nutricionista asignó este
  // objetivo. Mismo criterio que Table.assignedByTrainerId — permanente,
  // exención de límite depende de relación activa, no de este campo solo.
  assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // Auditoría de arquitectura (nutrición) — mismo concepto de periodo que
  // PlanAssignment, opcional y retrocompatible: un objetivo sin estos campos
  // se sigue comportando exactamente como hoy (el "actual" es el que apunta
  // User.goalInUse, sin vigencia temporal). Con ellos, un objetivo puede
  // programarse para una fase futura conocida.
  startDate: { type: String, default: null },
  endMode: { type: String, enum: ["fixedDate", "duration", "indefinite", null], default: null },
  endDate: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

NutritionalGoalSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("NutritionalGoal", NutritionalGoalSchema);
