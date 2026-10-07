const mongoose = require("mongoose");
const { CHECKIN_FIELDS, CHECKIN_FIELDS_BY_KEY, isPlausibleValue } = require("../trainerCheckins/checkin-field-catalog");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");

// Lo que el profesional PIDE en el cuestionario de alta además de preguntas:
// medidas, fotos de inicio y vídeos con lo que tiene que grabar el cliente.
// Cada petición es obligatoria u opcional. La configuración del profesional
// vive en User.trainerSettings.intake (trainer-intake-config-schema.js); al
// invitar se copia al par (TrainerClient.intakeForm, ver intakeFormOf) y las
// respuestas van a TrainerClient.intake (client-intake-schema.js).
//
// PURO: entra la configuración y lo que manda la app, salen valores limpios o
// un error. Sin Mongo (lo que necesita la base de datos, como comprobar que
// un día de fotos o un vídeo son del cliente, lo resuelve el service antes).

// Medidas que se pueden pedir: las del catálogo de check-in que van a
// Anthropometry (mismas etiquetas, instrucciones y cotas de plausibilidad),
// menos el peso, que el cuestionario pide siempre en el perfil
// (profileBiometrics).
const INTAKE_MEASUREMENT_KEYS = CHECKIN_FIELDS.filter((field) => field.storage === "anthropometry" && field.key !== "weight").map(
  (field) => field.key
);

// Poses de las fotos de inicio. `extra` (media-catalog.js#POSES) no se pide:
// es la foto libre que el cliente añade si quiere.
const INTAKE_PHOTO_POSES = ["front", "side", "back"];
const POSE_NAMES = { front: "frente", side: "perfil", back: "espalda" };

// Vídeos que puede pedir a la vez (cada uno es una grabación de hasta 3 min).
const MAX_INTAKE_VIDEOS = 5;
const VIDEO_LABEL_MAX = 200;

const isEmpty = (value) => value === undefined || value === null || value === "";

// --- Configuración del profesional ----------------------------------------------

/**
 * Medidas pedidas: [{ key, required }], sin repetir y en el orden del
 * catálogo (el del formulario del cliente). Devuelve { value } o { error }.
 */
function normalizeMeasurementRequests(input) {
  if (input == null) return { value: [] };
  if (!Array.isArray(input)) return { error: "Las medidas pedidas tienen que ser una lista" };
  const byKey = new Map();
  for (const item of input) {
    const key = item?.key;
    if (!INTAKE_MEASUREMENT_KEYS.includes(key)) return { error: `Medida no reconocida: ${key}` };
    byKey.set(key, { key, required: item.required === true });
  }
  return { value: INTAKE_MEASUREMENT_KEYS.filter((key) => byKey.has(key)).map((key) => byKey.get(key)) };
}

/** Fotos pedidas: null (no se piden) o { poses, required }. Devuelve { value } o { error }. */
function normalizePhotoRequest(input) {
  if (input == null || input === false) return { value: null };
  if (typeof input !== "object" || Array.isArray(input)) return { error: "Las fotos pedidas no tienen un formato válido" };
  const poses = Array.isArray(input.poses) ? input.poses : INTAKE_PHOTO_POSES;
  if (!poses.length) return { error: "Elige al menos una pose para las fotos" };
  const unknown = poses.find((pose) => !INTAKE_PHOTO_POSES.includes(pose));
  if (unknown !== undefined) return { error: `Pose no reconocida: ${unknown}` };
  return { value: { poses: INTAKE_PHOTO_POSES.filter((pose) => poses.includes(pose)), required: input.required === true } };
}

/**
 * Vídeos pedidos: [{ _id?, label, required, enabled }]. `label` es lo que
 * tiene que grabar («Sentadilla sin peso, de perfil»). Conserva el _id de
 * los que ya existían: las respuestas recibidas lo referencian. Desactivar
 * deja de pedirlo sin perder el texto, como las preguntas propias.
 */
function normalizeVideoRequests(input) {
  if (input == null) return { value: [] };
  if (!Array.isArray(input)) return { error: "Los vídeos pedidos tienen que ser una lista" };
  if (input.length > MAX_INTAKE_VIDEOS) return { error: `Como mucho ${MAX_INTAKE_VIDEOS} vídeos en el cuestionario` };
  const value = [];
  for (const item of input) {
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!label) return { error: "Cada vídeo necesita una indicación de qué tiene que grabar" };
    if (label.length > VIDEO_LABEL_MAX) return { error: `La indicación de un vídeo no puede pasar de ${VIDEO_LABEL_MAX} caracteres` };
    const id = item._id || item.id;
    value.push({
      ...(mongoose.isValidObjectId(id) ? { _id: id } : {}),
      label,
      required: item.required === true,
      enabled: item.enabled !== false,
    });
  }
  return { value };
}

// --- Formulario de cada cliente ---------------------------------------------------

/**
 * El formulario que recibe un cliente: la copia de lo que el profesional
 * tiene activo al invitarle (TrainerClient.intakeForm). Lo desactivado
 * (preguntas propias y vídeos) no se copia. Desde ese momento, cambiar la
 * configuración no cambia lo que se le pide a quien ya estaba invitado.
 * `config`: la configuración presentada (trainer-intake-config-service.js),
 * o null si el profesional nunca la guardó (todos los campos, nada más).
 */
function intakeFormOf(config) {
  const active = (items) => (items || []).filter((item) => item && item.enabled !== false);
  return {
    enabledFields: [...(config ? config.enabledFields || [] : INTAKE_FIELD_KEYS)],
    customQuestions: active(config?.customQuestions).map(({ _id, label, type, unit, options, required }) => ({
      _id,
      label,
      type,
      unit: unit || "",
      options: [...(options || [])],
      required: required === true,
    })),
    measurements: (config?.measurements || []).map(({ key, required }) => ({ key, required: required === true })),
    photos: config?.photos ? { poses: [...config.photos.poses], required: config.photos.required === true } : null,
    videos: active(config?.videos).map(({ _id, label, required }) => ({ _id, label, required: required === true })),
  };
}

// --- Respuestas del cliente ------------------------------------------------------

/**
 * Medidas que envía el cliente ([{ key, value }]) contra las pedidas. Las
 * obligatorias tienen que llegar; un valor imposible (las mismas cotas que
 * en los check-ins) se rechaza, porque una errata en la primera medida
 * falsea toda la evolución que se compare con ella; lo que no se pidió se
 * ignora. Devuelve { measurements: [{ key, value }] } o { error }.
 */
function buildIntakeMeasurements(requests, input) {
  const sent = new Map(
    (Array.isArray(input) ? input : []).filter((item) => item && typeof item.key === "string").map((item) => [item.key, item.value])
  );
  const measurements = [];
  for (const request of requests || []) {
    const field = CHECKIN_FIELDS_BY_KEY.get(request.key);
    if (!field) continue;
    const raw = sent.get(request.key);
    if (isEmpty(raw)) {
      if (request.required) return { error: `Falta la medida: ${field.label}` };
      continue;
    }
    const value = typeof raw === "string" ? Number(raw.replace(",", ".")) : raw;
    if (!isPlausibleValue(field, value)) return { error: `Revisa el valor de ${field.label}` };
    measurements.push({ key: request.key, value });
  }
  return { measurements };
}

/** Las medidas tal y como se guardan en Anthropometry ({ waist: 80, … }). */
function anthropometryFieldsOf(measurements) {
  const fields = {};
  for (const { key, value } of measurements || []) {
    const field = CHECKIN_FIELDS_BY_KEY.get(key);
    if (field?.anthropometryField) fields[field.anthropometryField] = value;
  }
  return fields;
}

/**
 * ¿Valen las fotos que manda el cliente? `day`: su día de fotos (ya
 * comprobado que es suyo) o null si no mandó ninguno. Obligatorias = todas
 * las poses pedidas; opcionales = las que quiera. Devuelve el error o null.
 */
function intakePhotosError(request, day) {
  if (!request?.required) return null;
  const taken = new Set((day?.photos || []).map((photo) => photo.pose));
  const missing = request.poses.filter((pose) => !taken.has(pose));
  if (!missing.length) return null;
  return `Faltan fotos que te pide tu profesional: ${missing.map((pose) => POSE_NAMES[pose] || pose).join(", ")}`;
}

/**
 * Vídeos que manda el cliente ([{ requestId, assetId }]) contra los pedidos
 * activos. `usable`: ids de vídeo de progreso del propio cliente (ya
 * comprobados por el service). Un vídeo por petición y peticiones distintas
 * con vídeos distintos. Devuelve { videos: [{ requestId, label, assetId }] }
 * o { error }.
 */
function buildIntakeVideos(requests, input, usable) {
  const sent = new Map(
    (Array.isArray(input) ? input : [])
      .filter((item) => item && item.requestId != null && !isEmpty(item.assetId))
      .map((item) => [String(item.requestId), String(item.assetId)])
  );
  const used = new Set();
  const videos = [];
  for (const request of (requests || []).filter((item) => item.enabled !== false)) {
    const requestId = String(request._id);
    const assetId = sent.get(requestId);
    if (!assetId) {
      if (request.required) return { error: `Falta el vídeo: ${request.label}` };
      continue;
    }
    if (!usable.has(assetId)) return { error: `Vuelve a subir el vídeo: ${request.label}` };
    if (used.has(assetId)) return { error: "Cada vídeo que te piden necesita su propia grabación" };
    used.add(assetId);
    videos.push({ requestId, label: request.label, assetId });
  }
  return { videos };
}

module.exports = {
  INTAKE_MEASUREMENT_KEYS,
  INTAKE_PHOTO_POSES,
  MAX_INTAKE_VIDEOS,
  VIDEO_LABEL_MAX,
  normalizeMeasurementRequests,
  normalizePhotoRequest,
  normalizeVideoRequests,
  intakeFormOf,
  buildIntakeMeasurements,
  anthropometryFieldsOf,
  intakePhotosError,
  buildIntakeVideos,
};
