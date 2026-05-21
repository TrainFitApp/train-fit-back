const mongoose = require("mongoose");
const Schema = mongoose.Schema;
const {
  LIMITS,
  numberField,
  applyRunValidators,
} = require("../util/validation-limits");

const SetSchema = Schema(
  {
    reps: numberField(LIMITS.workout.repsMin, LIMITS.workout.repsMax),
    weight: numberField(LIMITS.workout.weightMin, LIMITS.workout.weightMax),
    rir: [Number],
    expectedRir: [Number],
    expectedReps: [Number],
    drop: Boolean,
    restPause: numberField(
      LIMITS.workout.restPauseMin,
      LIMITS.workout.restPauseMax,
    ),
    cronometer: Number,
    doned: Boolean,
    order: Number,
    expectedMin: numberField(LIMITS.workout.minutesMin, LIMITS.workout.minutesMax),
    expectedSec: numberField(LIMITS.workout.secondsMin, LIMITS.workout.secondsMax),
    timeMin: numberField(LIMITS.workout.minutesMin, LIMITS.workout.minutesMax),
    timeSec: numberField(LIMITS.workout.secondsMin, LIMITS.workout.secondsMax),
    velocity: numberField(LIMITS.workout.velocityMin, LIMITS.workout.velocityMax),
  },
  { versionKey: false },
);

SetSchema.path("expectedReps").validate(function (values) {
  return (values || []).every(
    (value) =>
      value >= LIMITS.workout.repsMin && value <= LIMITS.workout.repsMax,
  );
}, "expectedReps fuera de rango");

SetSchema.path("expectedRir").validate(function (values) {
  return (values || []).every((value) => value === -1 || (value >= 0 && value <= 10));
}, "expectedRir fuera de rango");

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
      (Array.isArray(value) && value.length === 0)
    ) {
      doc[path] = undefined;
    }
  });
  next();
});
applyRunValidators(SetSchema);

module.exports = mongoose.model("Set", SetSchema);
