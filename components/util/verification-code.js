const CODE_MIN = 100000;
const CODE_MAX = 999999;
const CODE_REGEX = /^\d{6}$/;

function generateVerificationCode() {
  return Math.floor(CODE_MIN + Math.random() * (CODE_MAX - CODE_MIN + 1)).toString();
}

function isValidVerificationCodeFormat(code) {
  return typeof code === "string" && CODE_REGEX.test(code);
}

module.exports = { generateVerificationCode, isValidVerificationCodeFormat };
