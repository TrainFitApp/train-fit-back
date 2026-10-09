const { test } = require("node:test");
const assert = require("node:assert/strict");
const { confirmTarget, confirmationError, confirmArg } = require("./confirm-target");

const fakeDb = (databaseName) => ({
  databaseName,
  collection: () => ({ estimatedDocumentCount: async () => 3 }),
});

test("solo vale el nombre exacto de la base", () => {
  assert.equal(confirmationError("pro", "pro"), null);
  assert.equal(confirmationError("pro", "  pro \n"), null, "se perdonan los espacios al teclear");
  assert.match(confirmationError("pro", "pre"), /"pre" no es "pro"/);
  assert.match(confirmationError("pro", null), /--confirm=pro/);
});

test("--confirm da el nombre por tecleado; sin terminal no se puede confirmar", async () => {
  const logs = [];
  await confirmTarget(fakeDb("pro"), { uri: "mongodb://localhost/pro", action: "Migrar", confirm: "pro", log: (line) => logs.push(line) });
  assert.match(logs[0], /Migrar en mongodb:\/\/localhost\/pro · base "pro" · 3 usuarios, 3 productos/);

  await assert.rejects(confirmTarget(fakeDb("pre"), { uri: "x", action: "Migrar", confirm: "pro" }), /"pro" no es "pre"/);
  await assert.rejects(confirmTarget(fakeDb("pre"), { uri: "x", action: "Migrar", interactive: false }), /hay que confirmarlo/);
});

test("lee --confirm de los argumentos", () => {
  assert.equal(confirmArg(["--drop-old", "--confirm=pro"]), "pro");
  assert.equal(confirmArg(["--drop-old"]), null);
});
