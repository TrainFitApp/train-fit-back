const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase 5 Coach Pro — grupos de intercambio de alimentos (§16).
//
// Regla de fondo de la especificación: **NO asumir equivalencias
// automáticamente**. El sistema no calcula que 100 g de pollo equivalen a
// 120 g de pavo por sus macros — eso depende del criterio del coach (¿iguala
// proteína? ¿calorías? ¿volumen?) y de lo que quiera para ESE cliente. Aquí
// solo se guarda lo que el coach decide, con la cantidad que él escribe.
//
// Por eso un grupo es una lista de alimentos con su cantidad equivalente, y
// no una fórmula. El primero de la lista actúa como referencia ("100 g de
// pollo"), y el resto se leen contra él.
const ExchangeItemSchema = new Schema(
  {
    // Referencia opcional al producto real del catálogo. Opcional porque un
    // coach puede querer escribir "Pan integral" sin buscarlo: el intercambio
    // es una guía para el cliente, no un cálculo que necesite macros.
    productId: { type: Schema.Types.ObjectId, ref: "Product", default: null },
    // Nombre tal y como quiere que lo lea el cliente. Se guarda siempre,
    // incluso con productId: si el producto se renombra o desaparece del
    // catálogo, el intercambio debe seguir siendo legible.
    name: { type: String, required: true, trim: true, maxlength: 120 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true, trim: true, maxlength: 20, default: "g" },
    // Nota del coach para ESE alimento ("escurrido", "en crudo").
    note: { type: String, trim: true, maxlength: 200, default: "" },
  },
  { _id: true }
);

const FoodExchangeGroupSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Categoría libre del coach ("Proteína", "Carbohidrato", "Grasa"): no un
    // enum, porque cada metodología nombra sus grupos a su manera y forzar
    // los tres macros dejaría fuera cosas como "Verduras libres".
    category: { type: String, trim: true, maxlength: 50, default: "" },
    // Con qué criterio son equivalentes estos alimentos. Texto libre y
    // visible para el cliente: es lo que evita que un intercambio se
    // malinterprete ("equivalen en proteína, no en calorías").
    equivalenceNote: { type: String, trim: true, maxlength: 300, default: "" },
    // Movimiento 5 Coach Pro — el criterio de equivalencia, esta vez en
    // forma de número, para la calculadora de etiquetas.
    //
    // Sigue sin romper la regla de fondo del componente ("el sistema NO
    // calcula equivalencias"): esto NO convierte un alimento en otro. Lo que
    // permite es que, cuando el entrenador ya ha decidido que su ración de
    // hidratos son 15 g, la app le diga que un producto con 30 g por
    // ración son 2 raciones. La aritmética la hace la app; la decisión —qué
    // se iguala y con cuánto— la sigue tomando él, y por eso estos campos
    // son opcionales.
    //
    // null = grupo sin base numérica: se comporta EXACTAMENTE como hasta
    // ahora, una lista de equivalencias escritas a mano.
    basis: {
      type: String,
      enum: ["protein", "carbs", "fat", "kcal", null],
      default: null,
    },
    // Cuánto de `basis` tiene UNA ración de este grupo (15 g de hidratos,
    // 90 kcal...). Sin basis no significa nada, y por eso van juntos.
    basisAmount: { type: Number, default: null, min: 0 },
    items: {
      type: [ExchangeItemSchema],
      validate: {
        validator: (items) => items.length >= 2,
        message: "Un grupo de intercambio necesita al menos 2 alimentos",
      },
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "foodexchangegroups" }
);

FoodExchangeGroupSchema.index({ trainerId: 1, name: 1 }, { unique: true });

FoodExchangeGroupSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("FoodExchangeGroup", FoodExchangeGroupSchema);
