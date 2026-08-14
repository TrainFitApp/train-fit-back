const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Rediseño de entrenamiento (empezar de 0, sesión 2026-08-09) — plantilla de
// DÍA/SESIÓN reutilizable del profesional, mismo espíritu que dietTemplates
// (nutrición): se construye una vez y se aplica a N clientes/splits en vez de
// rehacer cada ejercicio/serie desde cero. A diferencia de la Fase 1
// revertida de esta sesión, `blocks[].exercises[].sets` vive en la plantilla
// ya en formato de PRESCRIPCIÓN completo — al aplicar se materializan
// CustomExercise/Set reales (ver workout-template-dao.js#applyToSplit), no
// queda como metadata suelta sin consumidor.
//
// Los campos de TemplateSetSchema son un subconjunto 1:1 de los campos
// "expected*"/config ya existentes en sets/set-schema.js — deliberadamente NO
// se inventan expectedWeight/expectedTempo/rpe aquí (esos NO existen en el
// Set real, fueron revertidos en el Paso 0 de esta sesión). Si se quieren en
// el futuro, se diseñan junto con quién los edita de verdad (Fase D).
const TemplateSetSchema = {
  expectedReps: { type: [Number], default: [] },
  expectedRir: { type: [Number], default: [] },
  drop: { type: Boolean, default: false },
  restPause: { type: Number, default: null },
  expectedTime: { type: String, trim: true, maxlength: 20, default: "" },
  expectedDistance: { type: Number, default: null },
};

const TemplateExerciseSchema = {
  exercise: { type: Schema.Types.ObjectId, ref: "Exercise", required: true },
  order: { type: Number, default: 0 },
  notes: { type: String, trim: true, maxlength: 500, default: "" },
  sets: { type: [TemplateSetSchema], default: [] },
};

// `blocks` organiza el contenido de la plantilla (recta/superserie/circuito/
// calentamiento/finisher) — usado para autoría y listado del hub (Fase A).
// El Workout.blocks/CustomExercise.blockId equivalente en el Workout REAL
// resultante de aplicar la plantilla se reintroduce en la Fase B, integrado
// de verdad en current-workout.page.html Y workout.component.html a la vez
// (lección directa del error de la Fase 1 revertida) — hasta entonces,
// aplicar una plantilla materializa sus ejercicios en un Workout real pero en
// orden plano (ver workout-template-dao.js#materializeBlocksAsExercises).
const TemplateBlockSchema = {
  name: { type: String, trim: true, maxlength: 100, default: "" },
  type: {
    type: String,
    enum: ["straight", "superset", "circuit", "warmup", "finisher"],
    default: "straight",
  },
  order: { type: Number, default: 0 },
  rounds: { type: Number, default: null },
  restBetweenExercises: { type: Number, default: null },
  restBetweenRounds: { type: Number, default: null },
  instructions: { type: String, trim: true, maxlength: 500, default: "" },
  exercises: { type: [TemplateExerciseSchema], default: [] },
};

const WorkoutTemplateSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500, default: "" },
    level: {
      type: String,
      enum: ["principiante", "intermedio", "avanzado"],
      default: "intermedio",
    },
    tags: { type: [String], default: [] },
    equipment: { type: [String], default: [] },
    blocks: { type: [TemplateBlockSchema], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "workouttemplates" }
);

module.exports = mongoose.model("WorkoutTemplate", WorkoutTemplateSchema);
