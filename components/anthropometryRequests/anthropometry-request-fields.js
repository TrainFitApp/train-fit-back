const { CHECKIN_FIELDS } = require("../trainerCheckins/checkin-field-catalog");

// "Solicitar antropometría" pide un subconjunto del MISMO catálogo que ya
// usan los check-ins (composición corporal + perímetros) — nunca duplica
// etiquetas: son las mismas medidas que un check-in con esos campos
// activados ya escribiría en Anthropometry (ver checkin-controller.js#respond),
// solo que aquí viven en su propio documento con su propia cadencia en vez
// de compartir la de un check-in general de bienestar.
const ANTHROPOMETRY_REQUEST_FIELDS = CHECKIN_FIELDS.filter((f) => f.storage === "anthropometry");
const ANTHROPOMETRY_REQUEST_FIELD_KEYS = ANTHROPOMETRY_REQUEST_FIELDS.map((f) => f.key);

module.exports = { ANTHROPOMETRY_REQUEST_FIELDS, ANTHROPOMETRY_REQUEST_FIELD_KEYS };
