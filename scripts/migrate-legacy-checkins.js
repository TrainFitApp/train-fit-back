const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
const { occurrenceAt } = require("../components/trainerCheckins/checkin-schedule-dates");

// Rediseño de check-ins y medidas (2026-09) — se retira el sistema legacy.
//
// Había DOS motores midiendo lo mismo: la plantilla aplicada
// (TrainerCheckinTemplate + cadence weekly/biweekly, con recordatorio por
// email) y la programación de calendario (CheckinSchedule + frequency/
// interval, con aviso in-app). No era solo deuda estética: la adherencia,
// la Cartera y las alertas solo entendían el primero, así que un cliente con
// check-ins de calendario no puntuaba en ningún sitio aunque respondiera.
//
// Cada configuración aplicada se convierte en una programación equivalente:
//   weekly   → cada 1 semana
//   biweekly → cada 2 semanas
//   once     → una sola vez
//
// `legacyConfigId` queda apuntando a la que fue, y su índice único evita
// duplicar si la migración se ejecuta dos veces. Las ya marcadas como
// `calendarManaged` se saltan: esas ya tenían su programación.
//
// Uso:
//   node scripts/migrate-legacy-checkins.js --dry-run
//   node scripts/migrate-legacy-checkins.js
//   node scripts/migrate-legacy-checkins.js --keep   (no borra las viejas)

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");
const KEEP = hasFlag("--keep");

const LOG_PREFIX = "[migrate-legacy-checkins]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const DEFAULT_TIME = "09:00";
const DEFAULT_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Madrid";

const TIMING_BY_CADENCE = {
  weekly: { frequency: "weekly", interval: 1 },
  biweekly: { frequency: "weekly", interval: 2 },
  once: { frequency: "once", interval: 1 },
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN} keep=${KEEP} · timeZone=${DEFAULT_TIME_ZONE}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const legacy = mongoose.connection.collection("trainercheckintemplates");
  const schedules = mongoose.connection.collection("checkinschedules");

  const configs = await legacy.find({ calendarManaged: { $ne: true } }).toArray();
  log(`configuraciones legacy: ${configs.length}`);

  let migradas = 0;
  let vacias = 0;
  let yaExistian = 0;

  for (const config of configs) {
    const tieneContenido =
      config.enabledFields?.length || config.customQuestions?.some((q) => q.enabled !== false);
    if (!tieneContenido) {
      vacias++;
      continue;
    }

    const yaHay = await schedules.findOne({ legacyConfigId: config._id });
    if (yaHay) {
      yaExistian++;
      continue;
    }

    const timing = {
      startDate: todayIso(),
      time: DEFAULT_TIME,
      timeZone: DEFAULT_TIME_ZONE,
      ...(TIMING_BY_CADENCE[config.cadence] || TIMING_BY_CADENCE.weekly),
    };

    log(
      `cliente ${config.clientId} · ${config.cadence || "sin cadencia"} → ${timing.frequency}/${timing.interval}`
    );

    if (!DRY_RUN) {
      await schedules.insertOne({
        trainerId: config.trainerId,
        clientId: config.clientId,
        name: config.name || "Check-in",
        sourceTemplateId: config.sourceTemplateId || null,
        legacyConfigId: config._id,
        enabledFields: config.enabledFields || [],
        customQuestions: config.customQuestions || [],
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
    migradas++;
  }

  log(`migradas: ${migradas} · ya tenían programación: ${yaExistian} · sin contenido: ${vacias}`);

  // Las configuraciones aplicadas dejan de leerse desde ningún sitio: su
  // colección queda muerta. Las respuestas históricas NO están aquí (viven
  // en checkinresponses) y no se tocan.
  if (!DRY_RUN && !KEEP) {
    const { deletedCount } = await legacy.deleteMany({});
    log(`configuraciones legacy borradas: ${deletedCount}`);
  }
  if (DRY_RUN) log("dry-run: no se ha escrito nada");

  await mongoose.disconnect();
  ok("done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "FALLO", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
