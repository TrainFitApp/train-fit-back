const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

const LOG_PREFIX = "[verify-meal-slot-preferences]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-004 (MASTER_BACKLOG.md) — fix mínimo: confirma que un cliente puede
// desactivar/renombrar slots de comida estándar (preferencia de
// presentación, sin tocar el enum de 6 slots en ningún otro sitio), que la
// validación rechaza slots inventados, y que getMine devuelve lo guardado.
function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);
  ok("connected");

  const userSchema = require("../components/users/schema");
  const nutritionPreferencesSchema = require("../components/nutritionPreferences/nutrition-preferences-schema");
  const controller = require("../components/nutritionPreferences/nutrition-preferences-client-controller");

  const runId = new mongoose.Types.ObjectId().toString();
  const created = { client: null };

  try {
    created.client = await userSchema.create({
      email: `verify-meal-slots-${runId}@test.local`,
    });
    ok("cliente de prueba creado", created.client._id);

    // 1. Guardar una preferencia válida: desactivar Desayuno y Recena,
    //    renombrar Almuerzo -> "Lunch".
    const validReq = {
      auth: { userId: created.client._id.toString() },
      body: {
        disabledMealSlots: ["Desayuno", "Recena"],
        mealSlotLabels: { Almuerzo: "Lunch" },
      },
    };
    const validRes = mockRes();
    await controller.updateMine(validReq, validRes);
    assert.equal(validRes.statusCode, 200, "una preferencia válida debe guardarse (200)");
    assert.deepEqual(
      validRes.body.disabledMealSlots.sort(),
      ["Desayuno", "Recena"].sort(),
      "disabledMealSlots debe persistir tal cual",
    );
    assert.equal(
      validRes.body.mealSlotLabels.Almuerzo,
      "Lunch",
      "mealSlotLabels debe persistir tal cual",
    );
    ok("preferencia válida guardada y devuelta correctamente");

    // 2. getMine debe devolver lo mismo que se acaba de guardar.
    const getRes = mockRes();
    await controller.getMine({ auth: { userId: created.client._id.toString() } }, getRes);
    assert.deepEqual(getRes.body.disabledMealSlots.sort(), ["Desayuno", "Recena"].sort());
    ok("getMine devuelve la preferencia recién guardada");

    // 3. Un slot inventado debe rechazarse (400), sin llegar a guardarse.
    const invalidReq = {
      auth: { userId: created.client._id.toString() },
      body: { disabledMealSlots: ["Brunch"] },
    };
    const invalidRes = mockRes();
    await controller.updateMine(invalidReq, invalidRes);
    assert.equal(invalidRes.statusCode, 400, "un slot inventado debe rechazarse con 400");
    ok("slot inventado ('Brunch') rechazado correctamente con 400");

    // 4. Confirmar que el rechazo NO sobrescribió lo válido guardado antes.
    const getRes2 = mockRes();
    await controller.getMine({ auth: { userId: created.client._id.toString() } }, getRes2);
    assert.deepEqual(getRes2.body.disabledMealSlots.sort(), ["Desayuno", "Recena"].sort());
    ok("el intento inválido no corrompió la preferencia previa");

    console.log(`${LOG_PREFIX} PASS`);
  } finally {
    log("limpiando datos de prueba...");
    if (created.client) {
      await nutritionPreferencesSchema.deleteOne({ clientId: created.client._id });
      await userSchema.deleteOne({ _id: created.client._id });
    }
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
