const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Script MANUAL de demo (no autolimpiante, a diferencia de los verify-*.js)
// — inserta una respuesta de check-in real para el cliente de prueba "Jose
// Tf" (65ccf5fbcc983be50cc36abd) bajo la relación de entrenador activa que
// ya existe, para poder ver la pantalla "Reportes" con datos reales en el
// navegador. Ejecutar una sola vez; no borra nada al terminar (a propósito,
// es dato de demo visible, no de test).
async function main() {
  const mongoUri = buildMongoUri();
  console.log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);

  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");

  const clientId = "65ccf5fbcc983be50cc36abd";
  const relation = await TrainerClient.findOne({ clientId, status: "active" }).lean();
  if (!relation) {
    console.error("No se encontró relación activa para ese clientId — abortando");
    process.exit(1);
  }

  const response = await CheckinResponse.create({
    trainerId: relation.trainerId,
    clientId,
    respondedAt: new Date(),
    values: { stress_level: 2, sleep_hours: 7, training_adherence: 4, comment: "Buena semana, sin molestias." },
  });

  console.log("Respuesta de check-in de demo creada:", response._id.toString());
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("FAIL", error);
  process.exit(1);
});
