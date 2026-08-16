const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeEmail, isValidEmailFormat } = require("./normalize-email");

test("normalizeEmail", async (t) => {
  await t.test("lowercase email stays unchanged", () => {
    assert.equal(normalizeEmail("david.argente@gmail.com"), "david.argente@gmail.com");
  });

  await t.test("uppercase email is lowercased", () => {
    assert.equal(normalizeEmail("DAVID.ARGENTE@GMAIL.COM"), "david.argente@gmail.com");
  });

  await t.test("mixed-case email is lowercased", () => {
    assert.equal(normalizeEmail("David.Argente@Gmail.com"), "david.argente@gmail.com");
    assert.equal(normalizeEmail("DaViD.ArGeNtE@gMaIl.CoM"), "david.argente@gmail.com");
  });

  await t.test("leading/trailing spaces are trimmed", () => {
    assert.equal(normalizeEmail("  david@gmail.com  "), "david@gmail.com");
    assert.equal(normalizeEmail("  David.Argente@Gmail.COM  "), "david.argente@gmail.com");
  });

  await t.test("non-string input returns empty string", () => {
    assert.equal(normalizeEmail(null), "");
    assert.equal(normalizeEmail(undefined), "");
    assert.equal(normalizeEmail(123), "");
  });

  await t.test("all four documented variants normalize to the same value", () => {
    const variants = [
      "david.argente@gmail.com",
      "David.Argente@gmail.com",
      "DAVID.ARGENTE@GMAIL.COM",
      "DaViD.ArGeNtE@gMaIl.CoM",
    ];
    const normalized = variants.map(normalizeEmail);
    assert.ok(normalized.every((email) => email === "david.argente@gmail.com"));
  });
});

test("isValidEmailFormat", async (t) => {
  await t.test("accepts well-formed emails", () => {
    assert.equal(isValidEmailFormat("david@gmail.com"), true);
    assert.equal(isValidEmailFormat("david.argente+test@gmail.co.uk"), true);
  });

  await t.test("rejects malformed emails", () => {
    assert.equal(isValidEmailFormat("david@"), false);
    assert.equal(isValidEmailFormat("@gmail.com"), false);
    assert.equal(isValidEmailFormat("david gmail.com"), false);
    assert.equal(isValidEmailFormat("davidgmail.com"), false);
  });

  await t.test("rejects non-string input", () => {
    assert.equal(isValidEmailFormat(null), false);
    assert.equal(isValidEmailFormat(undefined), false);
  });
});
