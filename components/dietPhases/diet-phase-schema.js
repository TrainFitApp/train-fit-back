const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const DietMenuSchema = require("../dietTemplates/diet-menu-schema");

// Una FASE de dieta de un cliente (Hipertrofia, Minicut, Definición…): el plan
// que le pautó su profesional desde una fecha, partido en semanas naturales de
// lunes a domingo (docs/plan-semanas.md). Una fase acaba cuando empieza la
// siguiente: no hay fin previsto, solo el real.
//
// El contenido va DENTRO, versionado: `contents[0]` empieza con la fase y
// cada vez que el profesional prepara la semana siguiente con comida o
// cantidades distintas se añade otra versión desde su lunes. Las semanas
// intermedias heredan de la última versión que ya había empezado
// (week-content.js#contentAt). Nunca comparte ids con la plantilla de la que
// sale: editar o borrar la plantilla no toca a nadie.
//
// Las fases de un cliente forman una cadena (util/phase-chain.js): la que
// entra corta a la anterior con su fin real (diet-phase-service.js). Qué fase
// es la última, cuál rige un día o cuál sustituyó a cuál se deduce de las
// fechas; no se guarda.

const PhaseContentSchema = new Schema({
  // "YYYY-MM-DD": desde qué día rige esta versión. La primera, el inicio de la fase.
  startDate: { type: String, required: true },
  menus: { type: [DietMenuSchema], default: [] },
});

const PhaseTargetSchema = new Schema(
  {
    kcal: Number,
    protein: Number,
    carbs: Number,
    fat: Number,
    // El calculado del cliente, o el que el profesional tecleó encima.
    source: { type: String, enum: ["calculated", "manual"], default: "calculated" },
  },
  { _id: false }
);

// Cómo se calculó la necesidad del cliente al empezar la fase: los datos que
// entraron (peso y de dónde, altura, edad, sexo, pasos del hábito,
// entrenamiento, g/kg) y el desglose (BMR, factor, gasto, kcal y macros).
// `missing` con contenido = no se pudo calcular (faltaban biométricos). Las
// semanas siguientes se calculan al vuelo a su fecha de inicio.
const PhaseNeedSchema = new Schema(
  {
    computedAt: Date,
    missing: { type: [String], default: undefined },
    inputs: Schema.Types.Mixed,
    breakdown: Schema.Types.Mixed,
    target: Schema.Types.Mixed,
    stepsFromHabit: Schema.Types.Mixed,
  },
  { _id: false }
);

const DietPhaseSchema = new Schema(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // Quien la pautó. null si su cuenta ya no existe: la fase se queda como
    // historial del cliente (diet-phase-dao.js#releaseTrainerPhases).
    trainerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // De qué plantilla salió, solo informativo ("ver plantilla aplicada").
    // null si se construyó directamente para el cliente; puede quedar
    // apuntando a una plantilla ya borrada.
    sourceTemplateId: { type: Schema.Types.ObjectId, ref: "DietTemplate", default: null },
    startDate: { type: String, required: true },
    // Fin REAL: null mientras sigue corriendo; se estampa cuando otra la corta
    // o el profesional lo corrige a mano. Qué fase es la última o cuál
    // sustituyó a cuál sale del orden (util/phase-chain.js): no se guarda.
    endDate: { type: String, default: null },
    // Con qué números se pauta (kcal y macros), y los g/kg de proteína y grasa
    // que fijó el profesional (null = fórmula por defecto de
    // nutrition-target.js). Las semanas recalculan con estos mismos.
    target: { type: PhaseTargetSchema, default: undefined },
    proteinPerKg: { type: Number, default: null },
    fatPerKg: { type: Number, default: null },
    need: { type: PhaseNeedSchema, default: undefined },
    contents: { type: [PhaseContentSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "dietphases" }
);

DietPhaseSchema.plugin(mongooseAutopopulate);

// Una fase siempre tiene contenido, y el primero empieza con ella.
DietPhaseSchema.pre("validate", function (next) {
  if (!this.contents.length) {
    this.invalidate("contents", "Una fase necesita contenido");
  } else if (this.contents[0].startDate !== this.startDate) {
    this.invalidate("contents", "El primer contenido de una fase empieza con ella");
  }
  next();
});

// "¿Qué fase cubre esta fecha?" y "¿cuál es la última aplicada?": las
// consultas más frecuentes, siempre por cliente.
DietPhaseSchema.index({ clientId: 1, startDate: -1, createdAt: -1 });
// Qué fases usan un alimento o una receta (borrar catálogo en uso).
DietPhaseSchema.index({ "contents.menus.meals.alternatives.customProducts.product": 1 });
DietPhaseSchema.index({ "contents.menus.meals.alternatives.customRecipes.recipe": 1 });

// Borrado de cuenta: las fases del cliente se van con él; las que pautó un
// entrenador que se va se quedan como historial del cliente.
DietPhaseSchema.plugin(require("../util/account-cascade").accountCascade, {
  owners: ["clientId"],
  detach: { trainerId: (trainerId) => require("./diet-phase-dao").releaseTrainerPhases(trainerId) },
  authorship: ["assignedByTrainerId"],
});

module.exports = mongoose.model("DietPhase", DietPhaseSchema);
