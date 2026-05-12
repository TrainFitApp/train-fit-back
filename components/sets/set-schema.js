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
    expectedMin: Number,
    expectedSec: Number,
    timeMin: Number,
    timeSec: Number,
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
      (Array.isArray(value) && value.length === 0)
    ) {
      doc[path] = undefined;
    }
  });
  next();
});

module.exports = mongoose.model("Set", SetSchema);
