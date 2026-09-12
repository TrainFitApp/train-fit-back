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
// no una fórmula: cada alimento, en la cantidad que él escribió, vale UNA
// ración del grupo. El primero no es especial — hubo una época en que se
// llamaba "la referencia" y el resto se leían contra él, pero la aritmética
// nunca lo trató así (amountForExchanges multiplica cualquier alimento por
// las raciones pautadas), y eso solo es correcto si todos valen lo mismo.
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
    // LEGACY — sustituidos por `anchor` + `serving`, y mantenidos mientras
    // las apps publicadas los sigan leyendo. El controlador los deriva en
    // cada escritura (`basisAmount` = `serving[anchor]`), así que nunca
    // divergen del perfil. No escribas contra ellos: son de salida.
    basis: {
      type: String,
      enum: ["protein", "carbs", "fat", "kcal", null],
      default: null,
    },
    basisAmount: { type: Number, default: null, min: 0 },

    // --- El perfil de una ración (scripts/migrate-food-exchange-profiles.js) ---
    //
    // Qué iguala el grupo. Es el antiguo `basis` con otro nombre y una
    // función nueva: además de comunicar el criterio, es el macro que la
    // verificación exige clavado en cada alimento. Los otros tres se
    // informan pero no se exigen — igualar proteína hace que la grasa varíe
    // necesariamente, y marcar eso como error sería marcar el método.
    anchor: {
      type: String,
      enum: ["protein", "carbs", "fat", "kcal", null],
      default: null,
    },
    // Las cuatro macros de UNA ración. Sustituye a `basisAmount`, que era
    // una sola cifra — y con una sola cifra el reparto del día no se puede
    // comparar contra las kcal ni contra los otros dos macros del objetivo.
    // El cuadre era imposible por el modelo, no por la interfaz.
    //
    // Cada macro null por separado: un producto que no declara grasa no es
    // un producto con 0 g de grasa, y un perfil a medias no debe sumar en el
    // cuadre como si estuviera completo.
    serving: {
      kcal: { type: Number, default: null, min: 0 },
      protein: { type: Number, default: null, min: 0 },
      carbs: { type: Number, default: null, min: 0 },
      fat: { type: Number, default: null, min: 0 },
    },
    // Quién es el dueño del perfil. `manual` = lo escribió el entrenador y
    // no se toca solo nunca; `computed` = sale de las macros de los productos
    // vinculados y se recalcula al cambiar los alimentos. Sin esta marca, o
    // se pisa un número suyo o se congela uno obsoleto: las dos son peores.
    servingSource: { type: String, enum: ["manual", "computed"], default: "computed" },
    // Cuánto puede desviarse un alimento del anchor antes de marcarse.
    // Por grupo y no global: igualar proteína admite menos holgura que
    // igualar calorías, y quien lo sabe es él.
    tolerancePct: { type: Number, default: 10, min: 0, max: 100 },
    // Qué papel juega el grupo al repartir el día. Lo usa la propuesta de
    // reparto (exchange-plan.util.ts), que resuelve en el orden clásico:
    // primero lo que se fija por criterio (verdura, fruta, lácteo), luego los
    // hidratos que falten, luego la proteína descontando la que ya aportan
    // los anteriores, y por último la grasa descontando la de la proteína.
    //
    // null = el grupo no entra en la propuesta. No se deduce del `anchor`:
    // un grupo puede igualar proteína y ser el lácteo del reparto, y solo él
    // sabe cuál es cuál.
    role: {
      type: String,
      enum: ["carb", "protein", "fat", "vegetable", "fruit", "dairy", null],
      default: null,
    },
    // "Verduras libres": no se pesa y no entra en el cuadre del día.
    // Explícito, en vez de deducirlo de que el perfil esté vacío — un grupo
    // libre y un grupo sin terminar no son lo mismo y no se avisan igual.
    freeQuantity: { type: Boolean, default: false },
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
