const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { MongoClient } = require("mongodb");

// Los comandos tal cual se lanzan en PRO (node scripts/migrate-modelo-datos.js),
// contra un mongod efímero con una base de la forma vieja.
const SCRIPT = path.join(__dirname, "migrate-modelo-datos.js");
let mongod;
let client;
let uri;

before(async () => {
  const { MongoMemoryServer } = require("mongodb-memory-server-core");
  mongod = await MongoMemoryServer.create();
  uri = mongod.getUri("pro");
  client = await MongoClient.connect(uri);
});

after(async () => {
  await client?.close();
  await mongod?.stop();
});

const run = (...args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env: { ...process.env, MONGODB_URI: uri }, timeout: 120000 }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, output: stdout + stderr }),
    );
  });

async function snapshot() {
  const db = client.db();
  const state = {};
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    state[name] = (await db.collection(name).indexes()).map((index) => index.name).sort();
  }
  return state;
}

test("el dry-run no escribe nada en la base: ni colecciones ni índices de los modelos", async () => {
  const db = client.db();
  await db.collection("users").insertOne({ email: "Cliente@Example.test", name: "Cliente" });
  await db.collection("dietdays").insertOne({ date: "2026-01-10", meals: [] });
  await db.collection("products").insertOne({ name: "Avena", namePrefixes: ["a", "av"] });
  const before = await snapshot();

  const { code, output } = await run("--dry-run");

  assert.equal(code, 0, output);
  assert.match(output, /dry-run: no se ha escrito nada/);
  assert.deepEqual(await snapshot(), before);
  assert.equal((await db.collection("users").findOne()).email, "Cliente@Example.test");
});

test("sin confirmar el nombre de la base no migra nada", async () => {
  const before = await snapshot();

  const wrong = await run("--confirm=pre");
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.output, /"pre" no es "pro"/);

  const silent = await run();
  assert.notEqual(silent.code, 0, "sin terminal y sin --confirm no se puede confirmar");
  assert.match(silent.output, /hay que confirmarlo/);

  assert.deepEqual(await snapshot(), before);
});
