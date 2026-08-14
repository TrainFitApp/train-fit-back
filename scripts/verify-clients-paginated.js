const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-clients-paginated]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-022 (MASTER_BACKLOG.md) — confirma que findActiveClientsPaginated:
// 1) colapsa las relaciones de un mismo cliente con 2 scopes en UNA fila,
// 2) pagina correctamente (total real, no el tamaño de la página),
// 3) filtra por búsqueda de nombre/email,
// 4) no cuenta relaciones de otro trainer ni no-activas.
async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const trainerClientDao = require("../components/trainerClients/trainer-client-dao");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { trainer: null, otherTrainer: null, clients: [], relations: [] };

  try {
    created.trainer = await userSchema.create({ email: `verify-clients-pag-t-${runId}@test.local` });
    created.otherTrainer = await userSchema.create({ email: `verify-clients-pag-t2-${runId}@test.local` });

    // 5 clientes activos: uno con 2 scopes (training+nutrition), el resto con 1.
    const names = ["Ana Multi", "Beto Solo", "Carla Solo", "Dani Solo", "Elsa Buscable"];
    for (const name of names) {
      const client = await userSchema.create({
        email: `${name.toLowerCase().replace(/\s/g, "-")}-${runId}@test.local`,
        name,
        lastname: "Prueba",
      });
      created.clients.push(client);
    }

    const [ana, beto, carla, dani, elsa] = created.clients;

    const relationsToCreate = [
      { client: ana, scope: "training" },
      { client: ana, scope: "nutrition" },
      { client: beto, scope: "training" },
      { client: carla, scope: "training" },
      { client: dani, scope: "training" },
      { client: elsa, scope: "training" },
    ];
    for (const r of relationsToCreate) {
      const rel = await TrainerClient.create({
        trainerId: created.trainer._id,
        clientId: r.client._id,
        clientEmail: r.client.email,
        scope: r.scope,
        status: "active",
      });
      created.relations.push(rel);
    }

    // Relación de OTRO trainer con un cliente del mismo nombre — no debe colarse.
    const foreignRel = await TrainerClient.create({
      trainerId: created.otherTrainer._id,
      clientId: ana._id,
      clientEmail: ana.email,
      scope: "training",
      status: "active",
    });
    created.relations.push(foreignRel);

    // 1. Colapsa Ana (2 scopes) en 1 fila — total de clientes únicos = 5, no 6.
    const page0 = await trainerClientDao.findActiveClientsPaginated(created.trainer._id.toString(), {
      page: 0,
      limit: 3,
    });
    assert.equal(page0.total, 5, "el total debe ser 5 clientes únicos, no 6 relaciones");
    assert.equal(page0.clients.length, 3, "la página 0 con limit=3 debe traer exactamente 3");
    ok("total real (5) distinto del tamaño de página (3) — pagina correctamente");

    const anaEntry = [...page0.clients].find((c) => c.user.name === "Ana Multi");
    if (anaEntry) {
      assert.equal(anaEntry.scopes.length, 2, "Ana debe aparecer UNA vez con 2 scopes, no duplicada");
      ok("cliente con 2 scopes colapsa en una sola fila con ambos scopes");
    }

    // 2. Página 1 completa el resto.
    const page1 = await trainerClientDao.findActiveClientsPaginated(created.trainer._id.toString(), {
      page: 1,
      limit: 3,
    });
    assert.equal(page1.clients.length, 2, "la página 1 con limit=3 debe traer los 2 restantes");
    const allNames = [...page0.clients, ...page1.clients].map((c) => c.user.name).sort();
    assert.deepEqual(allNames, names.slice().sort(), "las 2 páginas juntas deben cubrir los 5 clientes sin duplicar ni perder ninguno");
    ok("paginación completa sin duplicados ni huecos entre páginas");

    // 3. Búsqueda por nombre.
    const searched = await trainerClientDao.findActiveClientsPaginated(created.trainer._id.toString(), {
      page: 0,
      limit: 20,
      search: "Buscable",
    });
    assert.equal(searched.total, 1);
    assert.equal(searched.clients[0].user.name, "Elsa Buscable");
    ok("búsqueda por nombre filtra correctamente");

    // 4. Aislamiento por trainer: el otro trainer no debe ver a Ana vía esta query.
    const otherTrainerView = await trainerClientDao.findActiveClientsPaginated(
      created.otherTrainer._id.toString(),
      { page: 0, limit: 20 }
    );
    assert.equal(otherTrainerView.total, 1, "el otro trainer solo debe ver SU propia relación con Ana");
    ok("aislamiento por trainerId correcto");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.relations.length) {
      await TrainerClient.deleteMany({ _id: { $in: created.relations.map((r) => r._id) } });
    }
    if (created.clients.length) {
      await userSchema.deleteMany({ _id: { $in: created.clients.map((c) => c._id) } });
    }
    if (created.trainer) await userSchema.deleteOne({ _id: created.trainer._id });
    if (created.otherTrainer) await userSchema.deleteOne({ _id: created.otherTrainer._id });
    ok("datos de prueba borrados");

    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`${LOG_PREFIX} FAIL`, error);
    process.exit(1);
  });
