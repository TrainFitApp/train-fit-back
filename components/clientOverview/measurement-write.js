const crypto = require("crypto");
const mongoose = require("mongoose");
const anthropometrySchema = require("../anthropometry/anthropometry-schema");
const { CHECKIN_FIELDS, isPlausibleAnthropometry } = require("../trainerCheckins/checkin-field-catalog");
const { validDate, civilToday } = require("./body-metrics");
const { getTimeZone } = require("./measurement-profile");

const Anthropometry = mongoose.models.Anthropometry || mongoose.model("Anthropometry", anthropometrySchema);
const receiptSchema = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, required: true },
  requestId: { type: String, required: true },
  payloadHash: { type: String, required: true },
  date: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  source: { type: String, required: true },
  status: { type: String, enum: ["pending", "applied", "conflict"], default: "pending" },
  before: mongoose.Schema.Types.Mixed,
  after: mongoose.Schema.Types.Mixed,
  result: mongoose.Schema.Types.Mixed,
}, { timestamps: true, collection: "measurementcorrections" });
receiptSchema.index({ clientId: 1, requestId: 1 }, { unique: true });
const Receipt = mongoose.models.MeasurementCorrection || mongoose.model("MeasurementCorrection", receiptSchema);
const fieldsByName = new Map(CHECKIN_FIELDS.filter((field) => field.storage === "anthropometry")
  .map((field) => [field.anthropometryField, field]));

function fail(message, status = 400, code = "INVALID_MEASUREMENT", extra = {}) {
  return Object.assign(new Error(message), { status, statusCode: status, code, ...extra });
}

function validateInput({ date, fields, requestId }, today) {
  if (!validDate(date) || date > today) throw fail("Indica una fecha real que no esté en el futuro");
  if (typeof requestId !== "string" || !/^[a-zA-Z0-9:._-]{8,256}$/.test(requestId)) throw fail("Falta el identificador del guardado");
  if (!fields || typeof fields !== "object" || Array.isArray(fields) || !Object.keys(fields).length) throw fail("Añade alguna medición");
  for (const [key, value] of Object.entries(fields)) {
    if (!fieldsByName.has(key) || !isPlausibleAnthropometry(key, value)) throw fail(`Revisa la medida de ${fieldsByName.get(key)?.label || key}`);
  }
}

function expectedFilter(current, fields, expectedValues = {}) {
  const expected = {};
  const currentValues = {};
  for (const [key, value] of Object.entries(fields)) {
    const previous = current?.[key] ?? null;
    currentValues[key] = previous;
    if (Object.prototype.hasOwnProperty.call(expectedValues, key)) {
      if (expectedValues[key] !== previous) throw fail("La medida cambió. Revisa el valor actual antes de corregirla", 409, "MEASUREMENT_CONFLICT", { currentValues });
    } else if (previous !== null && previous !== value) {
      throw fail("Ya existe una medida para ese día. Confirma el valor que quieres corregir", 409, "MEASUREMENT_CONFLICT", { currentValues });
    }
    expected[key] = previous;
  }
  return expected;
}

function publicResult(row) {
  const result = { _id: row._id, date: row.date, userId: row.userId };
  for (const key of fieldsByName.keys()) if (row[key] !== undefined) result[key] = row[key];
  return result;
}

async function upsertMeasurement(input) {
  const { clientId, trainerId, date, fields, expectedValues = {}, requestId, source = "professional" } = input;
  validateInput(input, civilToday(await getTimeZone(clientId)));
  const actorId = trainerId || clientId;
  const ordered = Object.fromEntries(Object.entries(fields).sort(([a], [b]) => a.localeCompare(b)));
  const payloadHash = crypto.createHash("sha256").update(JSON.stringify({ date, fields: ordered, actorId: String(actorId), source })).digest("hex");
  let receipt;
  let created = false;
  try {
    receipt = await Receipt.create({ clientId, requestId, payloadHash, date, actorId, source, after: ordered });
    created = true;
  } catch (error) {
    if (error.code !== 11000) throw error;
    receipt = await Receipt.findOne({ clientId, requestId }).lean();
  }
  if (!receipt || receipt.payloadHash !== payloadHash) throw fail("Este guardado ya se utilizó para otros datos. Vuelve a abrir la edición", 409, "REQUEST_CONFLICT");
  if (receipt.status === "applied") return receipt.result;
  if (receipt.status === "conflict") {
    const current = await Anthropometry.findOne({ userId: clientId, date }).lean();
    const currentValues = Object.fromEntries(Object.keys(fields).map(key => [key, current?.[key] ?? null]));
    throw fail("El intento anterior encontró otra medición. Actualiza los datos y confirma la corrección en un nuevo envío", 409, "MEASUREMENT_CONFLICT", { currentValues });
  }
  if (!created) {
    const applied = await Anthropometry.findOne({ userId: clientId, date, overviewOperations: String(receipt._id) }).lean();
    if (applied) {
      const result = { _id: applied._id, userId: applied.userId, date, ...receipt.after };
      await Receipt.updateOne({ _id: receipt._id }, { $set: { status: "applied", result } });
      return result;
    }
    // No repetir una escritura de resultado desconocido, ni recrear un registro borrado.
    throw fail("El guardado anterior necesita comprobarse. Actualiza los datos antes de volver a intentarlo", 409, "MEASUREMENT_PENDING");
  }
  try {
    const current = await Anthropometry.findOne({ userId: clientId, date }).lean();
    const expected = expectedFilter(current, fields, expectedValues);
    await Receipt.updateOne({ _id: receipt._id }, { $set: { before: expected } });
    let saved;
    try {
      saved = await Anthropometry.findOneAndUpdate(
        { userId: clientId, date, ...expected },
        { $set: ordered, $setOnInsert: { userId: clientId, date }, $addToSet: { overviewOperations: String(receipt._id) } },
        { new: true, upsert: !current, runValidators: true }
      ).lean();
    } catch (error) {
      if (error.code !== 11000) throw error;
      throw fail("Otra persona ha registrado medidas para ese día. Actualiza antes de guardar", 409, "MEASUREMENT_CONFLICT");
    }
    if (!saved) throw fail("La medida cambió mientras guardabas. Actualiza antes de corregirla", 409, "MEASUREMENT_CONFLICT");
    const result = publicResult(saved);
    await Receipt.updateOne({ _id: receipt._id }, { $set: { status: "applied", result } });
    return result;
  } catch (error) {
    if (error.status === 409) await Receipt.updateOne({ _id: receipt._id }, { $set: { status: "conflict" } });
    throw error;
  }
}

module.exports = { upsertMeasurement, validateInput, expectedFilter };
