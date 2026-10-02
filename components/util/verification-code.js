const crypto = require("node:crypto");

const CODE_MIN = 100000;
const CODE_MAX = 999999;
const CODE_REGEX = /^\d{6}$/;

// crypto.randomInt, no Math.random: el código activa la cuenta.
function generateVerificationCode() {
  return crypto.randomInt(CODE_MIN, CODE_MAX + 1).toString();
}

function isValidVerificationCodeFormat(code) {
  return typeof code === "string" && CODE_REGEX.test(code);
}

module.exports = { generateVerificationCode, isValidVerificationCodeFormat };
