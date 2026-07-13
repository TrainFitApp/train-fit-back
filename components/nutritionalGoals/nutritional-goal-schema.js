const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const NutritionalGoalSchema = new Schema({
  userId: {
    type: Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    default: "Default",
  },
  kcalTotal: { type: Number, default: 0 },
  proteinsGTotal: { type: Number, default: 0 },
  carbohydratesGTotal: { type: Number, default: 0 },
  fatGTotal: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

NutritionalGoalSchema.pre("save", function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model("NutritionalGoal", NutritionalGoalSchema);
