const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const { RULE_METRICS_BY_KEY, OPERATORS, MAX_PERIOD_DAYS } = require("./rule-metric-catalog");

// Fase 3 Coach Pro — la metodología del coach, guardada.
//
// Estructura WHEN -> IF -> THEN, que es como el propio coach la enuncia:
//   CUÁNDO  se evalúa (trigger)
//   SI      se cumplen estas condiciones (conditions + conditionLogic)
//   ENTONCES haz esto (actions)
//
// Convive con las 8 señales integradas de coach-signals-service.js en vez de
// sustituirlas: aquellas funcionan sin configurar nada y cubren lo que
// TODO coach necesita; estas son lo que cada coach añade de su propia
// metodología. Ambas escriben en la misma colección CoachAlert — por eso
// CoachAlert tiene `ruleId` desde la Fase 1 (null = señal del sistema).

const ConditionSchema = new Schema(
  {
    metric: {
      type: String,
      required: true,
      validate: {
        validator: (v) => RULE_METRICS_BY_KEY.has(v),
        message: "Métrica no reconocida en el catálogo de reglas",
      },
    },
    operator: {
      type: String,
      required: true,
      validate: {
        validator: (v) => Object.keys(OPERATORS).includes(v),
        message: "Operador no reconocido",
      },
    },
    value: { type: Number, required: true },
    // Solo lo usan las métricas con serie temporal. El resto lo ignoran (ver
    // periodAware en el catálogo). Tope = la ventana que carga el evaluador
    // nocturno: pedir más devolvería datos truncados sin avisar.
    periodDays: { type: Number, default: 14, min: 1, max: MAX_PERIOD_DAYS },
  },
  { _id: false }
);

const ActionSchema = new Schema(
  {
    // Cerrado a acciones NO DESTRUCTIVAS, decisión explícita de alcance:
    // ninguna regla puede modificar planes, calorías ni rutinas. Una regla
    // mal configurada puede, como mucho, generar ruido — nunca cambiarle la
    // dieta a 30 clientes de madrugada.
    type: { type: String, required: true, enum: ["create_alert", "create_task"] },
    // create_alert: el texto que verá el coach. create_task: el título.
    message: { type: String, required: true, trim: true, maxlength: 200 },
    priority: { type: String, enum: ["high", "medium", "low"], default: "medium" },
  },
  { _id: false }
);

const CoachRuleSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    enabled: { type: Boolean, default: true },

    // --- Nivel de automatización (§13 de la especificación) ---
    //   informative: solo crea la alerta. El coach mira y decide.
    //   suggestion:  crea la alerta con una tarea PROPUESTA que el coach
    //                acepta con un clic (la tarea no existe hasta entonces).
    //   automatic:   crea la alerta Y la tarea, sin intervención.
    // Los tres son no destructivos — ver ActionSchema.
    level: {
      type: String,
      enum: ["informative", "suggestion", "automatic"],
      default: "informative",
    },

    // --- WHEN ---
    // El job corre igual cada noche para todas las reglas; el trigger decide
    // a QUÉ CLIENTES se aplica en esa pasada, no cuándo corre el job.
    // "after_checkin"/"after_measurement" limitan a los clientes con datos
    // nuevos desde la última evaluación de esta regla, que es lo que evita
    // repetir un veredicto sobre información que no ha cambiado.
    trigger: {
      type: String,
      enum: ["daily", "after_checkin", "after_measurement"],
      default: "daily",
    },

    // --- IF ---
    conditions: {
      type: [ConditionSchema],
      validate: {
        validator: (v) => v.length > 0 && v.length <= 5,
        message: "Una regla necesita entre 1 y 5 condiciones",
      },
    },
    // Solo "todas" (AND) u "cualquiera" (OR), sin árboles anidados. Un
    // constructor visual con paréntesis deja de ser visual y pasa a ser un
    // editor de expresiones con otro aspecto — justo lo que la
    // especificación prohíbe.
    conditionLogic: { type: String, enum: ["all", "any"], default: "all" },

    // --- THEN ---
    actions: {
      type: [ActionSchema],
      validate: {
        validator: (v) => v.length > 0 && v.length <= 3,
        message: "Una regla necesita entre 1 y 3 acciones",
      },
    },

    // --- Alcance ---
    appliesTo: { type: String, enum: ["all_clients", "selected"], default: "all_clients" },
    clientIds: [{ type: Schema.Types.ObjectId, ref: "User" }],

    // Última vez que el evaluador la ejecutó. Lo usan los triggers
    // "after_*" para saber qué es "nuevo desde entonces".
    lastEvaluatedAt: { type: Date, default: null },
    // Marca de seguridad: si una pasada supera el tope de clientes
    // afectados, la regla se desactiva sola y esto explica por qué.
    disabledReason: { type: String, default: null },

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: "coachrules" }
);

// Consulta principal: "las reglas activas de este profesional" (evaluador
// nocturno) y "todas las de este profesional" (pantalla de gestión).
CoachRuleSchema.index({ trainerId: 1, enabled: 1 });

// Dos reglas del mismo coach no pueden llamarse igual: en un listado, dos
// filas "Estancamiento" son indistinguibles y editar una por otra es un
// error silencioso.
CoachRuleSchema.index({ trainerId: 1, name: 1 }, { unique: true });

CoachRuleSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("CoachRule", CoachRuleSchema);
