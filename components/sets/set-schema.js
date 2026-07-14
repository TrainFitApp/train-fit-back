const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const SetSchema = Schema(
  {
    reps: Number,
    weight: Number,
    rir: [Number],
    expectedRir: [Number],
    expectedReps: [Number],
    drop: Boolean,
    restPause: Number,
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
    expectedDistance: Number,
    distance: Number,
    velocity: Number,
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
