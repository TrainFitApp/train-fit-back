const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const crypto = require("crypto");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

/**
 * UN cliente de prueba con historia coherente, atado a un entrenador
 * concreto, para poder recorrer la pestaña Seguimiento con datos de verdad:
 * cola de revisión, comparación entre respuestas, pauta de peso y adherencia.
 *
 * Aparte del seed grande (seed-demo-coach-pro.js), que siembra tres clientes
 * y ya está atado a otra cuenta. Este usa su PROPIO espacio de ids
 * ("tf-mock:") para no rozar aquella demo: se pueden tener las dos a la vez.
 *
 * Mismas precauciones que el seed grande:
 *   1. Todos los _id son deterministas, derivados de un texto. Reejecutar no
 *      duplica: reescribe los mismos documentos.
 *   2. El correo va en @demo.trainfit.local, un dominio que no existe, así
 *      que no puede chocar con una cuenta real.
 *   3. --clean borra EXACTAMENTE lo que este script inserta, ni un documento
 *      más. No hace deleteMany sobre colecciones enteras.
 *
 * USO
 *   node scripts/seed-mock-client.js --trainer-email=daargente@hotmail.com
 *   node scripts/seed-mock-client.js --trainer-email=... --clean
 *
 * LA HISTORIA (para que la pantalla tenga algo que decidir)
 * Nerea lleva tres meses en recomposición: cumple, la cintura baja despacio y
 * el peso acompaña. Pero las dos últimas semanas duerme peor y el estrés ha
 * subido, y una solicitud se le cerró sin contestar. Es justo el caso en que
 * el entrenador tiene que cambiar algo en vez de felicitar — que es lo que
 * una pantalla de revisión tiene que dejar ver de un vistazo.
 */

const args = process.argv.slice(2);
const CLEAN = args.includes("--clean");
const EMAIL_TRAINER = (args.find((a) => a.startsWith("--trainer-email=")) || "").split("=")[1] || "";

const LOG = "[seed-mock-client]";
const log = (...a) => console.log(LOG, ...a);
const ok = (...a) => console.log(LOG, "OK", ...a);

const PASSWORD = "Mock1234!";
const EMAIL_CLIENTE = "nerea.mock@demo.trainfit.local";
const ZONA = "Europe/Madrid";

function oid(semilla) {
  const hex = crypto.createHash("md5").update("tf-mock:" + semilla).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

const HOY = new Date();
const hace = (dias) => new Date(HOY.getTime() - dias * 86400000);
const isoHace = (dias) => hace(dias).toISOString().slice(0, 10);

// --- Antropometría: 13 semanas de peso, perímetros cada 4 ---
// Con ruido a propósito: el peso real no baja en línea recta, y una serie
// perfecta haría que la gráfica y las alertas mintieran sobre lo fácil que es.
const PESOS = [71.8, 71.9, 71.4, 71.5, 71.0, 70.8, 70.9, 70.4, 70.2, 70.3, 69.9, 69.7, 69.6];
const MEDIDAS_POR_SEMANA = {
  12: { waist: 79.5, abdomen: 86.0, hip: 99.0, chest: 92.0, fatMass: 21.4, muscleMass: 27.9 },
  8: { waist: 78.2, abdomen: 84.8, hip: 98.4, chest: 91.6, fatMass: 20.3, muscleMass: 28.1 },
  4: { waist: 77.0, abdomen: 83.5, hip: 97.8, chest: 91.5, fatMass: 19.4, muscleMass: 28.4 },
  0: { waist: 76.4, abdomen: 82.9, hip: 97.5, chest: 91.6, fatMass: 18.9, muscleMass: 28.6 },
};

const CAMPOS_BIENESTAR = [
  "training_adherence",
  "recovery_between_sessions",
  "sleep_quality",
  "general_fatigue",
  "stress_level",
  "hunger_satiety",
  "nutrition_plan_adherence",
  "sleep_hours",
  "daily_steps",
  "comment",
];

const CAMPOS_MEDIDAS = [
  "weight",
  "fat_mass",
  "muscle_mass",
  "perimeter_waist",
  "perimeter_navel",
  "perimeter_hip",
  "perimeter_chest",
];

// Una pregunta propia del entrenador, para que se vea el bloque "Tus
// preguntas" al final de la tabla de revisión.
const PREGUNTA_ID = oid("pregunta:hombro");
const PREGUNTA = {
  _id: PREGUNTA_ID,
  label: "¿Cómo va el hombro derecho en press?",
  type: "scale_1_5",
  required: true,
  enabled: true,
  unit: "",
  options: [],
};

// Ocurrencias del check-in semanal. El reparto de estados es lo que da
// contenido a la cola "Por revisar" y a la adherencia.
const SEMANAS = [
  { dias: 1, estado: "pending" },
  { dias: 8, estado: "responded" },
  { dias: 15, estado: "responded" },
  { dias: 22, estado: "unanswered" },
  { dias: 29, estado: "reviewed", revision: "El ritmo de bajada está bien. Sigue durmiendo esas 7 h y no toques nada." },
  { dias: 36, estado: "reviewed", revision: "Cintura bajando y fuerza intacta: vamos por donde queremos." },
  { dias: 43, estado: "reviewed", revision: "Ojo con los pasos, han caído. Intenta no bajar de 8.000." },
  { dias: 50, estado: "reviewed", revision: "Buena semana. Mantenemos cargas y subimos 100 kcal los días de entreno." },
  { dias: 57, estado: "reviewed", revision: "Primer mes cerrado. A partir de aquí medimos cintura cada 4 semanas." },
];

// Bienestar semana a semana: cumple siempre, pero el sueño se deteriora y el
// estrés sube en las dos últimas. Sin esa pendiente, la tabla de comparación
// repetiría el mismo número y no habría nada que revisar.
const BIENESTAR = {
  8: { training_adherence: 5, recovery_between_sessions: 2, sleep_quality: 2, general_fatigue: 4, stress_level: 4, hunger_satiety: 2, nutrition_plan_adherence: 4, sleep_hours: 5.5, daily_steps: 7400, comment: "Semana de cierre en el trabajo. He entrenado todo, pero llego reventada." },
  15: { training_adherence: 5, recovery_between_sessions: 3, sleep_quality: 3, general_fatigue: 3, stress_level: 3, hunger_satiety: 3, nutrition_plan_adherence: 4, sleep_hours: 6.2, daily_steps: 8100, comment: "Voy cumpliendo, aunque duermo peor que el mes pasado." },
  22: { training_adherence: 5, recovery_between_sessions: 4, sleep_quality: 4, general_fatigue: 2, stress_level: 2, hunger_satiety: 3, nutrition_plan_adherence: 5, sleep_hours: 7.4, daily_steps: 9200, comment: "Semana redonda, sin antojos." },
  29: { training_adherence: 4, recovery_between_sessions: 4, sleep_quality: 4, general_fatigue: 2, stress_level: 2, hunger_satiety: 3, nutrition_plan_adherence: 4, sleep_hours: 7.1, daily_steps: 8800, comment: "Falté un día por un viaje, lo recuperé el sábado." },
  36: { training_adherence: 5, recovery_between_sessions: 4, sleep_quality: 4, general_fatigue: 2, stress_level: 2, hunger_satiety: 3, nutrition_plan_adherence: 5, sleep_hours: 7.3, daily_steps: 9600, comment: "Subí 2,5 kg en press banca. Contenta." },
  43: { training_adherence: 4, recovery_between_sessions: 3, sleep_quality: 3, general_fatigue: 3, stress_level: 3, hunger_satiety: 3, nutrition_plan_adherence: 4, sleep_hours: 6.8, daily_steps: 6900, comment: "Muchas horas sentada esta semana." },
  57: { training_adherence: 4, recovery_between_sessions: 4, sleep_quality: 4, general_fatigue: 2, stress_level: 2, hunger_satiety: 4, nutrition_plan_adherence: 4, sleep_hours: 7.5, daily_steps: 8600, comment: "Arrancando bien, me está costando la cena." },
};
const HOMBRO = { 8: 2, 15: 3, 22: 4, 29: 4, 36: 4, 43: 3, 57: 3 };

// Revisiones de medidas, cada 4 semanas.
const MEDICIONES = [
  { dias: 2, estado: "responded", semana: 0 },
  { dias: 30, estado: "reviewed", semana: 4, revision: "Menos 1,2 cm de cintura en cuatro semanas con el peso casi igual: eso es recomposición, no estancamiento." },
  { dias: 58, estado: "reviewed", semana: 8, revision: "Primera tanda de medidas. A partir de aquí comparamos contra esta." },
];

// Hábitos diarios. Sin ellos la adherencia global se calcularía sobre una
// sola dimensión, y la Cartera no enseñaría de qué está hecha.
const HABITOS = [
  { semilla: "hab:pasos", type: "steps", label: null, target: 9000, unit: "pasos", cumplePct: 0.82 },
  { semilla: "hab:agua", type: "water", label: null, target: 2.2, unit: "L", cumplePct: 0.93 },
  { semilla: "hab:movilidad", type: "custom", label: "10 min de movilidad de hombro", target: 10, unit: "min", cumplePct: 0.55 },
];

const NOTAS = [
  { semilla: "nota:1", pinned: true, dias: 40, text: "Hombro derecho: molestias en press por encima de la cabeza. Sustituido por press inclinado con mancuernas." },
  { semilla: "nota:2", pinned: true, dias: 60, text: "Trabaja a turnos cada tres semanas. Cuando le toca noche, el sueño y los pasos se caen: no es dejadez." },
  { semilla: "nota:3", pinned: false, dias: 20, text: "Prefiere entrenar temprano. No programarle check-ins con aviso a mediodía." },
];

async function sembrar(trainer) {
  const User = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const Anthropometry = mongoose.models.Anthropometry
    || mongoose.model("Anthropometry", require("../components/anthropometry/anthropometry-schema"));
  const CheckinSchedule = require("../components/trainerCheckins/checkin-schedule-schema");
  const CheckinRequest = require("../components/trainerCheckins/checkin-request-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const WeightPlan = require("../components/weightPlans/weight-plan-schema");
  const TrainerNote = require("../components/trainerNotes/trainer-note-schema");
  const TrainerTask = require("../components/trainerTasks/trainer-task-schema");
  const TaskCompletion = require("../components/trainerTasks/task-completion-schema");

  const clientId = oid("user:nerea");

  // create() y no updateOne(): el hook pre('save') del esquema es lo que
  // cifra la contraseña. Con updateOne se guardaría en claro.
  await User.deleteOne({ _id: clientId });
  await User.create({
    _id: clientId,
    name: "Nerea",
    lastname: "Vidal (mock)",
    email: EMAIL_CLIENTE,
    password: PASSWORD,
    status: "active",
    roles: ["user"],
    sex: 0,
    height: 168,
    birth: new Date("1996-06-18"),
    weight: PESOS[PESOS.length - 1],
    activity: 1.45,
    objetive: -300,
    training: 1.5,
    steps: 9000,
    theme: "dark",
    lang: "es",
  });
  log(`cliente Nerea Vidal (mock) -> ${clientId}`);

  // Las dos relaciones: así la ficha enseña las dos subpestañas de Plan y la
  // adherencia puede promediar de verdad.
  for (const scope of ["training", "nutrition"]) {
    await TrainerClient.updateOne(
      { _id: oid("rel:" + scope) },
      {
        $set: {
          trainerId: trainer._id,
          clientId,
          clientEmail: EMAIL_CLIENTE,
          scope,
          status: "active",
          acceptedAt: hace(95),
          // Solo el documento de entrenamiento lo lleva (ver el esquema): de
          // aquí sale el preset sugerido en "Montar seguimiento de una vez".
          ...(scope === "training" ? { trainingGoalType: "hypertrophy" } : {}),
        },
      },
      { upsert: true }
    );
  }

  // --- Antropometría ---
  let mediciones = 0;
  for (let semana = 12; semana >= 0; semana--) {
    const doc = { weight: PESOS[12 - semana] };
    if (MEDIDAS_POR_SEMANA[semana]) Object.assign(doc, MEDIDAS_POR_SEMANA[semana]);
    await Anthropometry.updateOne(
      { _id: oid("antro:" + semana) },
      { $set: { userId: clientId, date: isoHace(semana * 7), ...doc } },
      { upsert: true }
    );
    mediciones++;
  }
  log(`${mediciones} mediciones`);

  // --- Programaciones ---
  const idSemanal = oid("sched:semanal");
  const idMedidas = oid("sched:medidas");
  await CheckinSchedule.updateOne(
    { _id: idSemanal },
    {
      $set: {
        trainerId: trainer._id, clientId, name: "Check-in semanal",
        sourceTemplateId: null, legacyConfigId: null,
        enabledFields: CAMPOS_BIENESTAR, customQuestions: [PREGUNTA],
        startDate: isoHace(57), time: "09:00", timeZone: ZONA,
        frequency: "weekly", interval: 1, active: true,
        nextRunAt: hace(-6), revision: 0,
      },
    },
    { upsert: true }
  );
  await CheckinSchedule.updateOne(
    { _id: idMedidas },
    {
      $set: {
        trainerId: trainer._id, clientId, name: "Medidas corporales",
        sourceTemplateId: null, legacyConfigId: null,
        enabledFields: CAMPOS_MEDIDAS, customQuestions: [],
        startDate: isoHace(58), time: "09:00", timeZone: ZONA,
        frequency: "weekly", interval: 4, active: true,
        nextRunAt: hace(-26), revision: 0,
      },
    },
    { upsert: true }
  );

  // La solicitud es el registro canónico (de ahí salen la cola de revisión y
  // la adherencia); la respuesta es su proyección y comparte _id, igual que
  // hace projectAnswer en producción.
  async function ocurrencia(semilla, base) {
    const contestada = base.status === "responded" || base.status === "reviewed";
    await CheckinRequest.updateOne(
      { _id: oid(semilla) },
      {
        $set: {
          trainerId: trainer._id, clientId, scheduleId: base.scheduleId,
          occurrenceKey: "mock:" + semilla,
          name: base.name, enabledFields: base.enabledFields,
          customQuestions: base.customQuestions,
          scheduledAt: hace(base.dias), closesAt: hace(base.dias - base.ventana),
          timeZone: ZONA, status: base.status,
          values: contestada ? base.values : {},
          respondedAt: contestada ? hace(base.dias - 0.2) : null,
          reviewedAt: base.status === "reviewed" ? hace(Math.max(0, base.dias - 1)) : null,
          reviewComment: base.revision || "",
          seenByTrainer: base.status === "reviewed",
          anthropometryProjectedAt: contestada ? hace(base.dias) : null,
        },
      },
      { upsert: true }
    );
    // Si esta ocurrencia deja de estar contestada (por ejemplo al reejecutar
    // el seed con otro reparto de estados), su proyección tiene que
    // desaparecer: si no, quedaría una respuesta sin solicitud que la
    // respalde, y contaría como contestada en el histórico.
    if (!contestada) {
      await CheckinResponse.deleteOne({ _id: oid(semilla) });
      return;
    }
    await CheckinResponse.updateOne(
      { _id: oid(semilla) },
      {
        $set: {
          trainerId: trainer._id, clientId, scheduleId: base.scheduleId,
          name: base.name, respondedAt: hace(base.dias - 0.2),
          values: base.values, status: base.status,
          reviewedAt: base.status === "reviewed" ? hace(Math.max(0, base.dias - 1)) : null,
          reviewComment: base.revision || "",
          customQuestions: base.customQuestions,
          seenByTrainer: base.status === "reviewed",
        },
      },
      { upsert: true }
    );
  }

  for (const semana of SEMANAS) {
    const valores = BIENESTAR[semana.dias]
      ? { ...BIENESTAR[semana.dias], ["custom:" + PREGUNTA_ID]: HOMBRO[semana.dias] }
      : {};
    await ocurrencia("chk:semanal:" + semana.dias, {
      scheduleId: idSemanal, name: "Check-in semanal",
      enabledFields: CAMPOS_BIENESTAR, customQuestions: [PREGUNTA],
      dias: semana.dias, ventana: 7, status: semana.estado,
      values: valores, revision: semana.revision,
    });
  }

  for (const m of MEDICIONES) {
    const s = MEDIDAS_POR_SEMANA[m.semana];
    await ocurrencia("chk:medidas:" + m.dias, {
      scheduleId: idMedidas, name: "Medidas corporales",
      enabledFields: CAMPOS_MEDIDAS, customQuestions: [],
      dias: m.dias, ventana: 28, status: m.estado,
      values: {
        weight: PESOS[Math.max(0, 12 - m.semana)],
        fat_mass: s.fatMass, muscle_mass: s.muscleMass,
        perimeter_waist: s.waist, perimeter_navel: s.abdomen,
        perimeter_hip: s.hip, perimeter_chest: s.chest,
      },
      revision: m.revision,
    });
  }
  log(`${SEMANAS.length + MEDICIONES.length} solicitudes de check-in`);

  await WeightPlan.updateOne(
    { _id: oid("peso") },
    { $set: { trainerId: trainer._id, clientId, intervalDays: 3, notes: "", lastReminderSentAt: null } },
    { upsert: true }
  );

  // --- Hábitos y su cumplimiento ---
  let marcas = 0;
  for (const h of HABITOS) {
    const taskId = oid(h.semilla);
    await TrainerTask.updateOne(
      { _id: taskId },
      {
        $set: {
          trainerId: trainer._id, clientId, type: h.type, label: h.label,
          target: h.target, unit: h.unit, active: true, createdAt: hace(60),
        },
      },
      { upsert: true }
    );
    // Cumplimiento repartido con un patrón fijo (no aleatorio): reejecutar
    // el seed tiene que dar exactamente los mismos días marcados.
    for (let d = 0; d < 28; d++) {
      const cumple = (d * 7919) % 100 < h.cumplePct * 100;
      if (!cumple) continue;
      await TaskCompletion.updateOne(
        { taskId, date: isoHace(d) },
        { $set: { completed: true, completedAt: hace(d) } },
        { upsert: true }
      );
      marcas++;
    }
  }
  log(`${HABITOS.length} hábitos y ${marcas} días marcados`);

  for (const n of NOTAS) {
    await TrainerNote.updateOne(
      { _id: oid(n.semilla) },
      { $set: { trainerId: trainer._id, clientId, text: n.text, pinned: n.pinned, createdAt: hace(n.dias) } },
      { upsert: true }
    );
  }
  log(`${NOTAS.length} notas`);
}

async function limpiar() {
  const M = {
    User: require("../components/users/schema"),
    TrainerClient: require("../components/trainerClients/trainer-client-schema"),
    Anthropometry: mongoose.models.Anthropometry
      || mongoose.model("Anthropometry", require("../components/anthropometry/anthropometry-schema")),
    CheckinSchedule: require("../components/trainerCheckins/checkin-schedule-schema"),
    CheckinRequest: require("../components/trainerCheckins/checkin-request-schema"),
    CheckinResponse: require("../components/trainerCheckins/checkin-response-schema"),
    WeightPlan: require("../components/weightPlans/weight-plan-schema"),
    TrainerNote: require("../components/trainerNotes/trainer-note-schema"),
    TrainerTask: require("../components/trainerTasks/trainer-task-schema"),
  };
  const ids = {};
  const push = (modelo, semilla) => {
    ids[modelo] = ids[modelo] || [];
    ids[modelo].push(oid(semilla));
  };

  push("User", "user:nerea");
  for (const scope of ["training", "nutrition"]) push("TrainerClient", "rel:" + scope);
  for (let semana = 0; semana <= 12; semana++) push("Anthropometry", "antro:" + semana);
  push("CheckinSchedule", "sched:semanal");
  push("CheckinSchedule", "sched:medidas");
  for (const s of SEMANAS) {
    push("CheckinRequest", "chk:semanal:" + s.dias);
    push("CheckinResponse", "chk:semanal:" + s.dias);
  }
  for (const m of MEDICIONES) {
    push("CheckinRequest", "chk:medidas:" + m.dias);
    push("CheckinResponse", "chk:medidas:" + m.dias);
  }
  push("WeightPlan", "peso");
  for (const n of NOTAS) push("TrainerNote", n.semilla);
  for (const h of HABITOS) push("TrainerTask", h.semilla);

  // Las marcas de cumplimiento no tienen _id determinista: cuelgan de su
  // tarea, así que se borran por taskId.
  const TaskCompletion = require("../components/trainerTasks/task-completion-schema");
  const borradasMarcas = await TaskCompletion.deleteMany({
    taskId: { $in: HABITOS.map((h) => oid(h.semilla)) },
  });
  if (borradasMarcas.deletedCount) log(`  TaskCompletion: ${borradasMarcas.deletedCount}`);

  let total = 0;
  for (const [modelo, lista] of Object.entries(ids)) {
    const { deletedCount } = await M[modelo].deleteMany({ _id: { $in: lista } });
    if (deletedCount) log(`  ${modelo}: ${deletedCount}`);
    total += deletedCount;
  }
  log(`${total} documentos borrados`);
}

async function main() {
  if (!EMAIL_TRAINER) {
    console.error(LOG, "falta --trainer-email=<correo del entrenador>");
    process.exit(1);
  }
  const uri = buildMongoUri();
  log(`conectando ${redactMongoUri(uri)}`);
  await mongoose.connect(uri);

  const User = require("../components/users/schema");
  const trainer = await User.findOne({ email: EMAIL_TRAINER }).select("_id email name lastname").lean();
  if (!trainer) {
    console.error(LOG, `no existe ningún usuario con el correo ${EMAIL_TRAINER}`);
    await mongoose.disconnect();
    process.exit(1);
  }
  log(`entrenador: ${trainer.name} ${trainer.lastname} <${trainer.email}> ${trainer._id}`);

  if (CLEAN) await limpiar();
  else {
    await sembrar(trainer);
    ok(`listo. Cliente: ${EMAIL_CLIENTE} / ${PASSWORD}`);
  }

  await mongoose.disconnect();
  ok("done");
}

main().catch(async (error) => {
  console.error(LOG, "FALLO", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
