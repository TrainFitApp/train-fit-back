const test = require("node:test");
const assert = require("node:assert/strict");
const { rankableFilter, readableFilter } = require("./diet-source-filter");

const TRAINER = "trainer-1";
const CLIENT = "client-1";

// Evalúa el $or contra un documento a mano (sin Mongo): solo hacen falta
// igualdad, null y $ne.
function matches(doc, clause) {
  return Object.entries(clause).every(([key, cond]) => {
    if (cond && typeof cond === "object" && "$ne" in cond) return doc[key] !== cond.$ne;
    if (cond === null) return doc[key] == null;
    return doc[key] === cond;
  });
}

function origins(doc, sources) {
  const filter = rankableFilter(TRAINER, CLIENT, sources);
  return filter.clientId === null && filter.$or.some((c) => matches(doc, c));
}

const DOCS = {
  mia: { trainerId: TRAINER, ownerClientId: null },
  delCliente: { trainerId: TRAINER, ownerClientId: CLIENT },
  deFabrica: { trainerId: "admin", ownerClientId: null, verified: true },
  deFabricaMia: { trainerId: TRAINER, ownerClientId: null, verified: true },
  ajena: { trainerId: "otro", ownerClientId: null },
  deOtroCliente: { trainerId: TRAINER, ownerClientId: "client-2" },
};

function pick(sources) {
  return Object.keys(DOCS).filter((k) => origins(DOCS[k], sources));
}

test("rankableFilter", async (t) => {
  await t.test("general: solo las mías, sin las de fábrica", () => {
    assert.deepEqual(pick(["general"]), ["mia"]);
  });

  await t.test("client: solo las de este cliente", () => {
    assert.deepEqual(pick(["client"]), ["delCliente"]);
  });

  await t.test("verified: las de fábrica, también la que creé yo", () => {
    assert.deepEqual(pick(["verified"]), ["deFabrica", "deFabricaMia"]);
  });

  await t.test("combinables: la unión de los elegidos", () => {
    assert.deepEqual(pick(["general", "verified"]), ["mia", "deFabrica", "deFabricaMia"]);
  });

  await t.test("sin origen, vacío o inválido = las tres", () => {
    const todas = ["mia", "delCliente", "deFabrica", "deFabricaMia"];
    assert.deepEqual(pick(undefined), todas);
    assert.deepEqual(pick([]), todas);
    assert.deepEqual(pick(["nope"]), todas);
    assert.deepEqual(pick(["general", "client", "verified"]), todas);
  });

  await t.test("nunca copias congeladas: clientId null siempre", () => {
    assert.equal(rankableFilter(TRAINER, CLIENT, ["client"]).clientId, null);
  });
});

test("readableFilter", async (t) => {
  const readable = (doc) => {
    const filter = readableFilter(TRAINER, doc._id);
    return doc._id === filter._id && filter.$or.some((c) => matches(doc, c));
  };

  await t.test("las mías, de biblioteca o copia asignada", () => {
    assert.equal(readable({ _id: "a", trainerId: TRAINER, clientId: null }), true);
    assert.equal(readable({ _id: "b", trainerId: TRAINER, clientId: CLIENT }), true);
  });

  await t.test("las de fábrica de cualquiera", () => {
    assert.equal(readable({ _id: "c", trainerId: "admin", clientId: null, verified: true }), true);
  });

  await t.test("ni las ajenas ni las copias asignadas de otro, aunque hereden verified", () => {
    assert.equal(readable({ _id: "d", trainerId: "otro", clientId: null }), false);
    assert.equal(readable({ _id: "e", trainerId: "admin", clientId: "client-9", verified: true }), false);
  });
});
