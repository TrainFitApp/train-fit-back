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

const { SUPPLEMENT_TIMINGS } = require("./supplement-catalog");

// Dos orígenes con el mismo modelo: lo que pauta un profesional (trainerId)
// y lo que el cliente se apunta él mismo (trainerId null), que solo puede
// añadir mientras no tenga profesional (supplement-service.js#createOwn).

const SupplementSchema = new Schema(
  {
    // null = suplemento propio del cliente, no pautado por nadie.
    trainerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
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
    // Desde cuándo y hasta cuándo se toma ("YYYY-MM-DD"). Una pauta de
    // suplementación tiene fechas como cualquier otra cosa que se pauta: por
    // eso aparece en el calendario y desaparece sola cuando termina.
    // `endDate` null = sin fecha de fin (se toma hasta nueva orden).
    startDate: { type: String, required: true },
    endDate: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Un entrenador no pauta dos veces el mismo suplemento al mismo cliente: si
// cambia la dosis, edita el que hay. El índice lo garantiza, también para los
// propios del cliente (trainerId null): uno por nombre.
SupplementSchema.index({ trainerId: 1, clientId: 1, name: 1 }, { unique: true });

SupplementSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId", "clientId"] });

module.exports = {
  Supplement: mongoose.model("Supplement", SupplementSchema),
};
