const { badRequest } = require("../util/http-error");

// PURO — lo que el propio usuario puede escribir de su perfil (registro,
// editor de perfil y fin del registro social). Lista BLANCA: cualquier otro
// campo (contraseña, sesión, roles, premium, plazas, consentimientos, ids
// de proveedor…) tiene su flujo propio y nunca entra por aquí.
const PROFILE_FIELDS = [
  "name",
  "lastname",
  "height",
  "birth",
  "sex",
  "activity",
  "objetive",
  "steps",
  "training",
  "theme",
  "lang",
  "personalAds",
];
// Punteros que ponen las pantallas de rutina (editor de perfil, no registro).
const POINTER_FIELDS = ["tableInUse", "workoutInUse"];

// El peso NO es un campo del usuario: vive en sus medidas (Anthropometry).
// Escribirlo en el perfil apunta el peso de hoy.
const MIN_WEIGHT = 30;
const MAX_WEIGHT = 300;

/** Solo los campos permitidos presentes en `body`. */
function pickProfile(body, { pointers = false } = {}) {
  const allowed = pointers ? [...PROFILE_FIELDS, ...POINTER_FIELDS] : PROFILE_FIELDS;
  const picked = {};
  for (const field of allowed) {
    if (body && Object.prototype.hasOwnProperty.call(body, field)) picked[field] = body[field];
  }
  return picked;
}

const sameId = (a, b) => String(a || "") === String(b || "");

/**
 * Qué escribir de los punteros de rutina que manda el editor. La app manda
 * el usuario entero, así que repetir la rutina o la sesión que ya tiene en
 * uso (`current`, la calculada: routineAssignments/routine-in-use.js) no es
 * una elección y no se escribe; si no, una fase de rutina dejaría de mandar
 * solo por guardar el perfil. Cambiar de rutina suelta la sesión a medias,
 * salvo que en la misma escritura se elija otra.
 * Devuelve { set, unset } (unset: lista de campos).
 */
function pointerChanges(requested, current, now = new Date()) {
  const set = {};
  const unset = [];
  const asks = (field) => Object.prototype.hasOwnProperty.call(requested || {}, field);
  const tableChanges = asks("tableInUse") && !sameId(requested.tableInUse, current.tableInUse);
  if (tableChanges) {
    if (requested.tableInUse) Object.assign(set, { tableInUse: requested.tableInUse, tableInUseAt: now });
    else unset.push("tableInUse", "tableInUseAt");
  }
  const newWorkout = asks("workoutInUse") && requested.workoutInUse && !sameId(requested.workoutInUse, current.workoutInUse);
  if (newWorkout) Object.assign(set, { workoutInUse: requested.workoutInUse, workoutInUseAt: now });
  else if (tableChanges || (asks("workoutInUse") && !requested.workoutInUse && current.workoutInUse)) {
    unset.push("workoutInUse", "workoutInUseAt");
  }
  return { set, unset };
}

/** Peso que acompaña al perfil: null si no viene; 400 si viene fuera de rango. */
function parseWeight(value) {
  if (value === undefined || value === null || value === "") return null;
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight < MIN_WEIGHT || weight > MAX_WEIGHT) {
    throw badRequest(`El peso tiene que estar entre ${MIN_WEIGHT} y ${MAX_WEIGHT} kg`, "INVALID_WEIGHT");
  }
  return Math.round(weight * 100) / 100;
}

module.exports = { PROFILE_FIELDS, POINTER_FIELDS, pickProfile, pointerChanges, parseWeight };
