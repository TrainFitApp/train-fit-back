const mongoose = require("mongoose");

const platformPolicySchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    minVersion: { type: String, default: "" },
  },
  { _id: false }
);

const runtimePolicySnapshotSchema = new mongoose.Schema(
  {
    changedAt: { type: Date, default: Date.now },
    changedBy: {
      userId: { type: String, default: null },
      email: { type: String, default: null },
    },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const appRuntimePolicySchema = new mongoose.Schema(
  {
    singletonKey: {
      type: String,
      default: "app_runtime_policy",
      unique: true,
      immutable: true,
    },
    maintenance: {
      enabled: { type: Boolean, default: false },
      title: {
        type: String,
        default: "Aplicacion en mantenimiento",
      },
      message: {
        type: String,
        default: "Estamos realizando mejoras. Vuelve en unos minutos.",
      },
      expectedEndAt: { type: Date, default: null },
      retryAfterSeconds: { type: Number, default: 300 },
    },
    updateRequired: {
      mode: {
        type: String,
        enum: ["off", "outdated_only", "all"],
        default: "off",
      },
      title: {
        type: String,
        default: "Nueva version disponible",
      },
      message: {
        type: String,
        default:
          "Para seguir usando TrainFit necesitas instalar la ultima version de la app.",
      },
      platforms: {
        ios: { type: platformPolicySchema, default: () => ({}) },
        android: { type: platformPolicySchema, default: () => ({}) },
        web: { type: platformPolicySchema, default: () => ({}) },
      },
    },
    revision: { type: Number, default: 1 },
    updatedBy: {
      userId: { type: String, default: null },
      email: { type: String, default: null },
    },
    history: { type: [runtimePolicySnapshotSchema], default: [] },
  },
  {
    timestamps: true,
    collection: "app_runtime_policy",
  }
);

module.exports = mongoose.model("AppRuntimePolicy", appRuntimePolicySchema);
