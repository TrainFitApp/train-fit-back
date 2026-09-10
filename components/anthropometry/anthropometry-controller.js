const anthropometryModel = require("./anthropometry-service");
const {
  CHECKIN_FIELDS,
  isPlausibleAnthropometry,
} = require("../trainerCheckins/checkin-field-catalog");

// El cliente escribe por aquí los MISMOS campos que ya escribe un check-in
// con medidas activadas (storage: "anthropometry"), así que la lista sale del
// catálogo y no de una copia a mano.
//
// La copia a mano existió y se quedó atrás: aceptaba 11 nombres, tres de
// ellos deprecados (bicepsRelaxed/bicepsContracted/calf, de cuando no había
// lateralidad). Los otros 15 campos del catálogo —masa muscular, masa grasa,
// hombros, cuádriceps, bíceps y gemelos por lado, tobillos— salían del
// formulario del cliente y se tiraban aquí en silencio: el cliente veía
// "guardado" y la medida no existía. La misma medida entrada por check-in sí
// llegaba, así que el mismo dato se comportaba distinto según por dónde
// entrase.
const MEASUREMENT_FIELDS = CHECKIN_FIELDS.filter(
  (field) => field.storage === "anthropometry"
);
const MEASUREMENT_FIELD_NAMES = MEASUREMENT_FIELDS.map(
  (field) => field.anthropometryField
);
const FIELD_DEF_BY_NAME = new Map(
  MEASUREMENT_FIELDS.map((field) => [field.anthropometryField, field])
);

// Solo lo que venga en el cuerpo: un campo ausente no se toca (ni al crear ni
// al actualizar), para no borrar lo que ya hubiera escrito un check-in ese
// mismo día.
function pickMeasurements(body = {}) {
  const data = {};
  for (const name of MEASUREMENT_FIELD_NAMES) {
    if (body[name] !== undefined && body[name] !== null) data[name] = body[name];
  }
  return data;
}

// Mismas cotas que aplica el check-in (ver checkin-field-catalog.js): un
// ombligo de 44 cm no es una medida, es un dedo que ha resbalado. Se
// comprobaba solo en la vía del check-in, así que esta era la puerta por la
// que seguían entrando erratas al mismo almacén.
function implausibleField(data) {
  for (const [name, value] of Object.entries(data)) {
    if (!isPlausibleAnthropometry(name, value)) return name;
  }
  return null;
}

function implausibleMessage(name) {
  const field = FIELD_DEF_BY_NAME.get(name);
  const unit = field?.unit ? ` ${field.unit}` : "";
  const range =
    field?.min !== undefined && field?.max !== undefined
      ? ` Debe estar entre ${field.min}${unit} y ${field.max}${unit}.`
      : "";
  return `"${field?.label || name}" no parece una medida real.${range}`;
}

function rejectImplausible(res, data) {
  const invalid = implausibleField(data);
  if (!invalid) return false;
  res.status(400).send({
    message: implausibleMessage(invalid),
    code: "ANTHROPOMETRY_VALUE_IMPLAUSIBLE",
  });
  return true;
}

const controller = {
  async createAnthropometry(req, res) {
    const measurements = pickMeasurements(req.body);
    if (rejectImplausible(res, measurements)) return;

    const anthropometry = await anthropometryModel.createAnthropometry({
      userId: req.user.id,
      date: req.body.date,
      ...measurements,
    });
    return res.send(anthropometry);
  },

  async getAnthropometryById(req, res) {
    const anthropometry = await anthropometryModel.getAnthropometryById(req.params.id);
    if (!anthropometry) return res.sendStatus(404);
    return res.send(anthropometry);
  },

  async getAnthropometryByUserIdAndDate(req, res) {
    const anthropometry = await anthropometryModel.getAnthropometryByUserIdAndDate(
      req.user.id,
      req.body.date
    );
    return res.send(anthropometry);
  },

  async getAnthropometriesByUserIdBetweenDates(req, res) {
    const anthropometries = await anthropometryModel.getAnthropometriesByUserIdBetweenDates(
      req.user.id,
      req.body.minDate,
      req.body.maxDate
    );
    return res.send(anthropometries);
  },

  async getAllAnthropometriesByUserId(req, res) {
    const anthropometries = await anthropometryModel.getAllAnthropometriesByUserId(req.user.id);
    return res.send(anthropometries);
  },

  async updateAnthropometry(req, res) {
    const measurements = pickMeasurements(req.body);
    if (rejectImplausible(res, measurements)) return;

    const anthropometry = await anthropometryModel.updateAnthropometry(
      req.params.id,
      measurements
    );
    if (!anthropometry) return res.sendStatus(404);
    return res.send(anthropometry);
  },

  async deleteAnthropometry(req, res) {
    await anthropometryModel.deleteAnthropometry(req.params.id);
    return res.sendStatus(204);
  },

  async upsertAnthropometry(req, res) {
    const measurements = pickMeasurements(req.body);
    if (rejectImplausible(res, measurements)) return;

    const anthropometry = await anthropometryModel.upsertAnthropometry(
      req.user.id,
      req.body.date,
      measurements
    );
    return res.send(anthropometry);
  },
};

module.exports = {
  ...controller,
  // Exportados para test unitario: son la lista de campos que de verdad se
  // aceptan y el filtro de plausibilidad, que es donde estaba el fallo.
  MEASUREMENT_FIELD_NAMES,
  pickMeasurements,
  implausibleField,
};
