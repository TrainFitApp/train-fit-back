// MongoDB efímero para tests de DAO y migraciones (sin servidor HTTP).
// Mismo arranque que harness.js: mongodb-memory-server con su propio mongod
// por fichero de test, nunca .env ni una base de datos real.
//
//   const { useTestDb } = require("../../integration/support/db");
//   const db = useTestDb();
//   test("…", async () => { await db.reset(); … });
//
// Los modelos que use el test tienen que estar requeridos ANTES de que
// arranque (al principio del fichero), para crear sus índices.

const { before, after } = require("node:test");
const mongoose = require("mongoose");

mongoose.set("strictQuery", true);

function useTestDb({ name = "trainfit_dao_test" } = {}) {
  let mongod = null;
  const ctx = { mongoose };

  before(async () => {
    const { MongoMemoryServer } = require("mongodb-memory-server-core");
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri(name), { serverSelectionTimeoutMS: 10000 });
    for (const modelName of mongoose.modelNames()) {
      await mongoose.model(modelName).init();
    }
  });

  after(async () => {
    await mongoose.disconnect().catch(() => {});
    if (mongod) await mongod.stop();
  });

  // Vacía todas las colecciones (los índices se quedan).
  ctx.reset = async () => {
    const collections = await mongoose.connection.db.collections();
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  };

  ctx.oid = (value) => (value ? new mongoose.Types.ObjectId(String(value)) : new mongoose.Types.ObjectId());

  // Inserta documentos en crudo (sin pasar por los schemas), para sembrar
  // datos en formatos antiguos en los tests de migración.
  ctx.raw = (collection) => mongoose.connection.db.collection(collection);

  return ctx;
}

module.exports = { useTestDb };
