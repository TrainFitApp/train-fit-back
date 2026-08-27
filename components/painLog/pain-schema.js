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

// Movimiento 3 Coach Pro — hasta dónde puede trabajar el cliente con esa
// zona y a partir de dónde tiene que parar. Lo fija EL ENTRENADOR, y por eso
// lleva trainerId: dos profesionales del mismo cliente pueden tener
// criterios distintos sobre la misma rodilla, y ninguno debe pisar al otro.
//
// Vive aquí y no en el registro diario porque no es un dato del día: es la
// pauta que se mantiene hasta que el entrenador la cambia.
const PainThresholdSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    zone: { type: String, required: true },
    // Hasta aquí se entrena con normalidad.
    workLevel: { type: Number, min: 0, max: 10, required: true },
    // Desde aquí se para. Nunca menor que workLevel — ver sanitizeThreshold.
    painLevel: { type: Number, min: 0, max: 10, required: true },
    note: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { timestamps: true }
);

PainThresholdSchema.index({ trainerId: 1, clientId: 1, zone: 1 }, { unique: true });

module.exports = {
  PainEntry: mongoose.model("PainEntry", PainEntrySchema),
  PainThreshold: mongoose.model("PainThreshold", PainThresholdSchema),
};
