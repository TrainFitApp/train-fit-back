const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const Schema = mongoose.Schema;
const dietSchema = require("../diets/diet-schema");
const exerciseSchema = require("../exercises/exercise-schema");
const ownTableSchema = require("../ownTables/own-table-schema");
const SALT_WORK_FACTOR = 10;

const UserSchema = new Schema({
  email: { type: String, unique: true, required: true },
  appleId: { type: String, unique: true, sparse: true },
  password: String,
  name: String,
  lastname: String,
  weight: Number,
  height: Number,
  status: String,
  roles: { type: [String], default: undefined },
  sex: Number,
  activity: Number,
  objetive: Number,
  steps: Number,
  stepGoal: Number,
  training: Number,
  birth: Date,
  kcalTotal: Number,
  proteinsGTotal: Number,
  carbohydratesGTotal: Number,
  fatGTotal: Number,
  hash: String,
  theme: { type: String, default: "dark" },
  dietInUse: Schema.Types.ObjectId,
  tableInUse: Schema.Types.ObjectId,
  workoutInUse: Schema.Types.ObjectId,
  ownTables: { type: [Schema.Types.ObjectId], default: [] },
  archivedDiets: { type: [Schema.Types.ObjectId], default: [] },
  archivedProducts: { type: [Schema.Types.ObjectId], default: [] },
  archivedRecipes: { type: [Schema.Types.ObjectId], default: [] },
  archivedTables: { type: [Schema.Types.ObjectId], default: [] },
  archivedExercises: { type: [Schema.Types.ObjectId], default: [] },
  personalAds: Boolean,
  lastLogin: Date,
  premium: {
    entitled: { type: Boolean, default: false },
    plan: String,
    expiresAt: Date,
    source: String,
    lastSyncAt: Date,
  },
  passwordVersion: { type: Number, default: 0 },
  lastPasswordChangeAt: Date,
  auth: {
    sessionId: { type: String, default: null, index: true },
    refreshTokenHash: { type: String, default: null },
    refreshExpiresAt: { type: Date, default: null },
    clientFamily: { type: String, default: null },
    platform: { type: String, default: null },
    issuedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
    impersonatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    impersonatedFromSessionId: { type: String, default: null },
  },
  provider: String,
});

UserSchema.plugin(require("mongoose-autopopulate"));

UserSchema.pre("save", function (next) {
  let user = this;
  if (!user.isModified("password")) return next();

  user.lastPasswordChangeAt = new Date();
  if (user.isNew) {
    user.passwordVersion = user.passwordVersion > 0 ? user.passwordVersion : 1;
  } else {
    user.passwordVersion = (user.passwordVersion || 0) + 1;
  }

  // generate a salt
  bcrypt.genSalt(SALT_WORK_FACTOR, function (err, salt) {
    if (err) return next(err);

    // hash the password using our new salt
    bcrypt.hash(user.password, salt, function (err, hash) {
      if (err) return next(err);
      // override the cleartext password with the hashed one
      user.password = hash;
      next();
    });
  });
});

// Middleware para eliminar las referencias al eliminar un usuario con deleteOne
UserSchema.pre("deleteOne", async function (next) {
  try {
    const query = this.getQuery();
    const user = await this.model.findOne(query);

    if (user) {
      // TODO: en el futuro habrá lista de ownDiets como en las ownTables
      if (user.dietInUse) await dietSchema.deleteOne({ _id: user.dietInUse });
      if (user.ownTables)
        await ownTableSchema.deleteMany({ _id: { $in: user.ownTables } });

      const ownExercises = await exerciseSchema
        .find({ userId: user._id })
        .select("_id")
        .lean();

      for (const exercise of ownExercises) {
        await exerciseSchema.deleteOne({ _id: exercise._id });
      }

      // Note: user-created products (with userId) are NOT deleted on user delete
      // to preserve data referenced in meals/customProducts.
    }
    next();
  } catch (e) {
    next(e);
  }
});

module.exports = mongoose.model("User", UserSchema);
