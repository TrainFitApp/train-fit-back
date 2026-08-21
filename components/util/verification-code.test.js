const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateVerificationCode,
  isValidVerificationCodeFormat,
} = require("./verification-code");

test("generateVerificationCode", async (t) => {
  await t.test("is always exactly 6 digits, nothing else", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateVerificationCode();
      assert.match(code, /^\d{6}$/, `code "${code}" is not purely 6 digits`);
    }
  });

  await t.test("is always within [100000, 999999]", () => {
    for (let i = 0; i < 500; i++) {
      const code = Number(generateVerificationCode());
      assert.ok(code >= 100000 && code <= 999999);
    }
  });
});

test("isValidVerificationCodeFormat", async (t) => {
  await t.test("accepts a well-formed 6-digit code", () => {
    assert.equal(isValidVerificationCodeFormat("123456"), true);
  });

  await t.test("rejects codes containing letters (base36 leak from the old bug)", () => {
    assert.equal(isValidVerificationCodeFormat("1a2b3c"), false);
  });

  await t.test("rejects codes shorter than 6 digits", () => {
    assert.equal(isValidVerificationCodeFormat("12345"), false);
  });

  await t.test("rejects codes longer than 6 digits", () => {
    assert.equal(isValidVerificationCodeFormat("1234567"), false);
  });

  await t.test("rejects non-string input", () => {
    assert.equal(isValidVerificationCodeFormat(123456), false);
    assert.equal(isValidVerificationCodeFormat(undefined), false);
    assert.equal(isValidVerificationCodeFormat(null), false);
  });

  await t.test("rejects codes with whitespace", () => {
    assert.equal(isValidVerificationCodeFormat(" 123456"), false);
    assert.equal(isValidVerificationCodeFormat("123456 "), false);
  });
});
