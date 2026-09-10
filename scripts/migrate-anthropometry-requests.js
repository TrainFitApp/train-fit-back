const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
const { occurrenceAt } = require("../components/trainerCheckins/checkin-schedule-dates");
const { CHECKIN_FIELDS_BY_KEY } = require("../components/trainerCheckins/checkin-field-catalog");

// Rediseño de check-ins y medidas (2026-09) — las "peticiones de medidas"
// dejan de ser un flujo propio. Cada una se reparte según lo que de verdad
// pedía:
//
//   · Solo el peso, y de forma recurrente  → pauta de peso (weightplans).
//     Es un número que el cliente ya toma solo; no necesita formulario,
//     solicitud ni revisión, solo cada cuánto debería haber uno nuevo.
//
//   · Cualquier otra cosa (perímetros, composición corporal, o una petición
//     de una sola vez) → programación de check-in (checkinschedules), con
//     los MISMOS campos y la MISMA periodicidad. Un check-in cuyas
//     preguntas son corporales: no hace falta un tipo nuevo.
//
// La colección vieja NO se borra aquí: se deja como estaba para poder
// comprobar el resultado y volver atrás. Borrarla es un paso aparte, a mano,
// cuando la migración esté verificada.
//
// Uso:
//   node scripts/migrate-anthropometry-requests.js --dry-run
//   node scripts/migrate-anthropometry-requests.js

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");

const LOG_PREFIX = "[migrate-anthropometry-requests]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const DEFAULT_TIME = "09:00";
const DEFAULT_TIME_ZONE =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Solo el peso y solo si se pedía de forma repetida: una petición de una vez
// no es una pauta ("pésate cada X días" no significa nada si es una sola).
function esPautaDePeso(request) {
  const fields = request.fields || [];
  return (
    request.cadence !== "once" &&
    fields.length > 0 &&
    fields.every((key) => CHECKIN_FIELDS_BY_KEY.get(key)?.anthropometryField === "weight")
  );
}

function intervalDaysDe(request) {
  if (request.cadence === "custom") return Math.max(1, Math.min(90, request.customIntervalDays || 7));
  return CADENCE_DAYS[request.cadence] || 7;
}

// El sistema de calendario habla de frequency + interval. "custom cada N
// días" es exactamente "daily con interval N" — no hace falta una cadencia
// nueva para eso. `interval` tiene tope 52 en el schema.
function timingDe(request) {
  const base = { startDate: todayIso(), time: DEFAULT_TIME, timeZone: DEFAULT_TIME_ZONE };
  if (request.cadence === "custom") {
    return { ...base, frequency: "daily", interval: Math.max(1, Math.min(52, request.customIntervalDays || 7)) };
  }
  if (request.cadence === "once") return { ...base, frequency: "once", interval: 1 };
  return { ...base, frequency: request.cadence, interval: 1 };
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN} · timeZone=${DEFAULT_TIME_ZONE}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const requests = mongoose.connection.collection("anthropometryrequests");
  const weightPlans = mongoose.connection.collection("weightplans");
  const schedules = mongoose.connection.collection("checkinschedules");

  const activas = await requests.find({ active: true }).toArray();
  log(`peticiones activas: ${activas.length}`);

  let pautas = 0;
  let programaciones = 0;
  let vacias = 0;

  for (const request of activas) {
    if (!request.fields?.length) {
      vacias++;
      continue;
    }

    if (esPautaDePeso(request)) {
      const intervalDays = intervalDaysDe(request);
      log(`pauta de peso · cliente ${request.clientId} · cada ${intervalDays} día(s)`);
      if (!DRY_RUN) {
        await weightPlans.updateOne(
          { trainerId: request.trainerId, clientId: request.clientId },
          {
            $set: { intervalDays, notes: request.notes || "" },
            $setOnInsert: {
              trainerId: request.trainerId,
              clientId: request.clientId,
              lastReminderSentAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
          { upsert: true }
        );
      }
      pautas++;
      continue;
    }

    const timing = timingDe(request);
    log(
      `check-in de medidas · cliente ${request.clientId} · ${request.fields.length} campo(s) · ${timing.frequency}/${timing.interval}`
    );
    if (!DRY_RUN) {
      await schedules.insertOne({
        trainerId: request.trainerId,
        clientId: request.clientId,
        name: "Medidas corporales",
        sourceTemplateId: null,
        legacyConfigId: null,
        enabledFields: request.fields,
        customQuestions: [],
        ...timing,
        active: true,
        nextRunAt: occurrenceAt(timing, 0),
        revision: 0,
        leaseUntil: null,
        leaseToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    programaciones++;
  }

  log(`resultado: ${pautas} pauta(s) de peso · ${programaciones} check-in(s) de medidas · ${vacias} sin campos`);
  if (DRY_RUN) log("dry-run: no se ha escrito nada");

  await mongoose.disconnect();
  ok("done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "FALLO", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
