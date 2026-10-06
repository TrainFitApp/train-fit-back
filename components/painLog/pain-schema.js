const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Movimiento 3 Coach Pro — una fila por (cliente, día, zona).
//
// Documento por zona y no un array por día, a propósito: la consulta que
// importa es "cómo va la rodilla derecha de este cliente en el último mes",
// y con un array por día habría que traerse todos los días y filtrar en
// Node. Con esta forma es un índice.
const PainEntrySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    // "YYYY-MM-DD", igual que Anthropometry y DietDay: el orden
    // lexicográfico coincide con el cronológico, así que $gte/$lte funcionan
    // sin parsear fechas.
    date: { type: String, required: true },
    zone: { type: String, required: true },
    level: { type: Number, min: 0, max: 10, required: true },
    note: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { timestamps: true }
);

// Una zona no puede tener dos niveles el mismo día. El cliente CORRIGE su
// registro (upsert), no lo acumula.
PainEntrySchema.index({ userId: 1, date: -1, zone: 1 }, { unique: true });

PainEntrySchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["userId"] });

module.exports = {
  PainEntry: mongoose.model("PainEntry", PainEntrySchema),
};
