const mongoose = require("mongoose");

const TutorialStepSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    title: { type: String, required: true },
    description: { type: String, required: true },
    // Referencia documental para quien edite el contenido (qué clase/id del
    // HTML corresponde a este step). El frontend NO la usa para localizar el
    // elemento en vivo (ver TutorialAnchorDirective) — solo para que quien
    // escriba el copy sepa a qué se está refiriendo.
    cssAnchor: { type: String },
  },
  { _id: false },
);

const TutorialSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    screenId: { type: String, required: true },
    level: { type: Number, enum: [1, 2, 3], required: true },
    order: { type: Number, default: 0 },
    // Nivel 3 (avanzado) no se dispara solo; el usuario lo abre a mano desde
    // Configuración > Tutoriales.
    autoStart: { type: Boolean, default: true },
    steps: { type: [TutorialStepSchema], default: [] },
  },
  { timestamps: true, collection: "tutorials" },
);

module.exports = mongoose.model("Tutorial", TutorialSchema);
