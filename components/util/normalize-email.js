// Única función de normalización de email del backend. La misma
// transformación (trim + lowercase) también está declarada a nivel de
// schema (components/users/schema.js, opciones `trim`/`lowercase` del path
// `email`), que Mongoose aplica automáticamente a creates, saves, updates y
// condiciones de query — esta función cubre los sitios que comparan o
// validan un email en JS puro antes/fuera de tocar la BD (comparar el email
// de un body contra el de un token de Google/Apple, rechazar un email vacío
// tras el trim con un 400 claro, etc.), para no depender únicamente del
// casting de Mongoose en esos casos.
const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function isValidEmailFormat(email) {
  return typeof email === "string" && EMAIL_FORMAT_REGEX.test(email);
}

module.exports = { normalizeEmail, isValidEmailFormat, EMAIL_FORMAT_REGEX };
