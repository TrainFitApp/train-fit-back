const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Una serie. Desde 2026-10 vive EMBEBIDA en su ejercicio
// (Workout.exercises[].sets[]), no en una colección propia: una sesión se lee
// y se escribe como un solo documento (ver docs/analisis-modelo-datos.md, P2).
// El `_id` de cada serie se conserva, así que las rutas por id
// (PUT /sets, DELETE /sets/:id) siguen funcionando igual.
const SetSchema = new Schema(
  {
    reps: { type: Number, min: 0, max: 999 },
    weight: { type: Number, min: 0, max: 2000 },
    // min: -1 porque -1 es el centinela de "FALLO" usado en toda la app
    // (ver set.component.ts), no un valor de RIR real.
    // `default: undefined`: una serie sin RIR no guarda `[]` (así eran los
    // documentos sueltos, y así los sigue recibiendo la app).
    rir: { type: [{ type: Number, min: -1, max: 20 }], default: undefined },
    expectedRir: { type: [{ type: Number, min: -1, max: 20 }], default: undefined },
    expectedReps: { type: [{ type: Number, min: 0, max: 999 }], default: undefined },
    drop: Boolean,
    restPause: { type: Number, min: 0, max: 600 },
    // Descanso pautado tras completar esta serie (segundos). Distinto de
    // restPause, que es la técnica "rest-pause" DENTRO de la misma serie.
    restSeconds: { type: Number, min: 0, max: 600 },
    // Cuándo se marcó doned=true. Solo lo fija el backend (set-dao.js), en
    // la transición false->true — nunca confiar en un timestamp del cliente.
    donedAt: Date,
    cronometer: Number,
    doned: Boolean,
    order: Number,
    // Duración pautada y hecha, "M:SS".
    expectedTime: String,
    time: String,
    expectedDistance: { type: Number, min: 0, max: 100000 },
    distance: { type: Number, min: 0, max: 100000 },
    velocity: { type: Number, min: 0, max: 50 },
  },
  { versionKey: false },
);

// Campos que se pueden escribir en una serie (todo menos `_id`). Las vías que
// reciben una serie del cliente la filtran con esta lista.
const SET_FIELDS = Object.keys(SetSchema.paths).filter((path) => path !== "_id");

// Una serie nueva se guarda sin huecos: null, false, "" y [] no se escriben
// (lo hacía el pre("save") de cuando las series eran documentos sueltos; los
// subdocumentos se escriben con operadores de actualización, que no lo
// disparan). `doned: false` queda ausente, que la app lee igual.
function compactSet(set) {
  const clean = {};
  for (const field of ["_id", ...SET_FIELDS]) {
    const value = set?.[field];
    if (value === null || value === undefined || value === false || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    clean[field] = value;
  }
  return clean;
}

module.exports = SetSchema;
module.exports.SET_FIELDS = SET_FIELDS;
module.exports.compactSet = compactSet;
