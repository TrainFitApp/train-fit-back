const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const AppConfigSchema = new Schema({
  maintenance: {
    enabled: { type: Boolean, default: false },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    message: { type: String, default: "" },
    warningMessage: { type: String, default: "" },
    warningFrom: { type: Date, default: null },
  },
  forceUpdate: {
    minVersionIos: { type: String, default: "" },
    minVersionAndroid: { type: String, default: "" },
    minVersionWeb: { type: String, default: "" },
    message: { type: String, default: "" },
  },
  updatedBy: { type: String, default: "" },
}, { timestamps: { createdAt: false } });

module.exports = mongoose.model("AppConfig", AppConfigSchema);
