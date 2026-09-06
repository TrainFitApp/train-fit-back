const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SetSchema = Schema(
  {
    reps: { type: Number, min: 0, max: 999 },
    weight: { type: Number, min: 0, max: 2000 },
    // min: -1 porque -1 es el centinela de "FALLO" usado en toda la app
    // (ver set.component.ts), no un valor de RIR real.
    rir: [{ type: Number, min: -1, max: 20 }],
    expectedRir: [{ type: Number, min: -1, max: 20 }],
    expectedReps: [{ type: Number, min: 0, max: 999 }],
    drop: Boolean,
    restPause: { type: Number, min: 0, max: 600 },
    // Descanso pautado tras completar esta serie (segundos). Distinto de
    // restPause, que es la técnica "rest-pause" DENTRO de la misma serie.
    restSeconds: { type: Number, min: 0, max: 600 },
    // Cuándo se marcó doned=true. Solo lo fija el backend (set-dao.js), en
    // la transición false->true — nunca confiar en un timestamp del cliente.
    donedAt: Date,
    cronometer: Number,
    doned: Boolean,
    order: Number,
    // DEPRECATED: reemplazados por expectedTime/time (string "M:SS").
    // Se mantienen en el schema temporalmente (rollout en fases, hay
    // usuarios con apps viejas instaladas) — quitar en una release de
    // limpieza posterior una vez la adopción de la app vieja caiga a ~0.
    expectedMin: Number,
    expectedSec: Number,
    timeMin: Number,
    timeSec: Number,
    expectedTime: String,
    time: String,
    expectedDistance: { type: Number, min: 0, max: 100000 },
    distance: { type: Number, min: 0, max: 100000 },
    velocity: { type: Number, min: 0, max: 50 },
  },
  { versionKey: false },
);

SetSchema.pre("save", function (next) {
  const doc = this;
  const paths = Object.keys(doc.schema.paths);

  paths.forEach((path) => {
    if (path === "_id" || path === "__v") return;
    const value = doc[path];

    if (
      value === null ||
      value === undefined ||
      value === false ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      doc[path] = undefined;
    }
  });
  next();
});

module.exports = mongoose.model("Set", SetSchema);
