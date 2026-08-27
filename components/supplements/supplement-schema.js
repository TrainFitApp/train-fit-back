const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Movimiento 5 Coach Pro — suplementación pautada.
//
// Componente propio y no un campo de NutritionalGoal: un suplemento no es un
// macro. Tiene su propio "cuándo" (en ayunas, antes de entrenar), su propia
// duración, y sobre todo cambia con independencia del objetivo calórico —
// obligarlos a viajar juntos haría que retocar las kcal reescribiera la
// pauta de suplementos, o al revés.
//
// Tampoco es un producto del catálogo: la creatina que recomienda un
// entrenador no se "come" dentro de una comida, no cuenta para la adherencia
// nutricional y no lleva macros que cuadrar. Meterla en DietDay la haría
// aparecer en los totales del día, que es exactamente lo que no debe pasar.

// Cuándo tomarlo. Lista cerrada con las pautas que un entrenador da de
// verdad; "custom" deja escribir cualquier otra sin abrir la puerta a que
// cada uno invente su propio vocabulario para lo mismo.
const SUPPLEMENT_TIMINGS = [
  { key: "waking", label: "Al levantarme" },
  { key: "breakfast", label: "Con el desayuno" },
  { key: "pre_workout", label: "Antes de entrenar" },
  { key: "intra_workout", label: "Durante el entrenamiento" },
  { key: "post_workout", label: "Después de entrenar" },
  { key: "with_meal", label: "Con una comida principal" },
  { key: "before_bed", label: "Antes de dormir" },
  { key: "custom", label: "Otro momento" },
];

const SupplementSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    // Texto libre y no un número con unidad: las dosis reales son "5 g",
    // "2 cápsulas", "1 medida rasa"... y forzar {cantidad, unidad} obligaría
    // a inventar unidades para la mitad.
    dose: { type: String, required: true, trim: true, maxlength: 60 },
    timing: {
      type: String,
      enum: SUPPLEMENT_TIMINGS.map((option) => option.key),
      default: "with_meal",
    },
    // Solo se usa con timing "custom". Se guarda aparte del enum para que
    // cambiar de "otro momento" a uno de la lista no pierda lo escrito.
    customTiming: { type: String, trim: true, maxlength: 100, default: "" },
    // Por qué se lo pauta. Lo lee el cliente: un suplemento sin motivo se
    // abandona a la tercera semana.
    reason: { type: String, trim: true, maxlength: 300, default: "" },
    // Dónde comprarlo. El entrenador puede dejarlo vacío; la app no
    // recomienda tiendas por su cuenta.
    purchaseUrl: { type: String, trim: true, maxlength: 500, default: "" },
    // Días de la semana en los que tomarlo (0 = domingo). Vacío = todos los
    // días, que es el caso normal y no obliga a marcar siete casillas.
    weekdays: { type: [Number], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Un entrenador no pauta dos veces el mismo suplemento al mismo cliente: si
// cambia la dosis, edita el que hay. El índice lo garantiza.
SupplementSchema.index({ trainerId: 1, clientId: 1, name: 1 }, { unique: true });

module.exports = {
  Supplement: mongoose.model("Supplement", SupplementSchema),
  SUPPLEMENT_TIMINGS,
};
