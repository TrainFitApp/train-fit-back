// Carga (o actualiza) el catálogo inicial de tutoriales de Entrenamientos en
// la colección `tutorials`. Es la única forma de poblar/editar el contenido
// en v1 (no hay UI de administración todavía). Idempotente: usa upsert por
// `key`, así que se puede re-ejecutar tras editar este archivo para
// actualizar títulos/mensajes sin duplicar documentos.
const mongoose = require("mongoose");
const { buildMongoUri } = require("./_mongo-uri");
const Tutorial = require("../components/tutorials/tutorial-schema");

const TUTORIALS = [
  {
    key: "training.introduction",
    screenId: "training.summary",
    level: 1,
    order: 0,
    autoStart: true,
    steps: [
      {
        key: "welcome",
        title: "Bienvenido",
        description:
          "Bienvenido a Entrenamientos. Aquí gestionarás tus rutinas y registrarás cada sesión.",
        cssAnchor: null,
      },
      {
        key: "routineInUse",
        title: "Tu rutina",
        description: "Aquí encontrarás tu rutina actual.",
        cssAnchor: ".section.current-routine",
      },
    ],
  },
  {
    key: "training.currentWorkout",
    screenId: "training.currentWorkout",
    level: 1,
    order: 1,
    autoStart: true,
    steps: [
      {
        key: "intro",
        title: "Registra tu progreso",
        description:
          "Aquí puedes registrar tus series, peso, repeticiones y RIR de cada ejercicio.",
        cssAnchor: "ion-reorder-group",
      },
    ],
  },
  {
    key: "training.finishWorkout",
    screenId: "training.currentWorkout",
    level: 1,
    order: 2,
    autoStart: true,
    steps: [
      {
        key: "finish",
        title: "Termina tu sesión",
        description: "Cuando termines, pulsa aquí para guardar tu sesión.",
        cssAnchor: ".finish-workout-row",
      },
    ],
  },
  {
    key: "training.rir",
    screenId: "training.currentWorkout",
    level: 1,
    order: 3,
    autoStart: true,
    steps: [
      {
        key: "rir",
        title: "RIR",
        description:
          "RIR: cuántas repeticiones más crees que podrías haber hecho antes del fallo.",
        cssAnchor: ".intensity-col",
      },
    ],
  },
  {
    key: "training.notes",
    screenId: "training.currentWorkout",
    level: 2,
    order: 4,
    autoStart: true,
    steps: [
      {
        key: "notes",
        title: "Notas",
        description:
          "Usa las notas para anotar sensaciones o ajustes de este ejercicio.",
        cssAnchor: ".note-btn",
      },
    ],
  },
  {
    key: "training.previousSession",
    screenId: "training.currentWorkout",
    level: 2,
    order: 5,
    autoStart: true,
    steps: [
      {
        key: "previousSession",
        title: "Sesión anterior",
        description: "Esta nota es de tu sesión anterior, no de hoy.",
        cssAnchor: ".note-wrapper.previous-session",
      },
    ],
  },
  {
    key: "training.addSeries",
    screenId: "training.currentWorkout",
    level: 2,
    order: 6,
    autoStart: true,
    steps: [
      {
        key: "addSeries",
        title: "Series extra",
        description: "¿Te sobran fuerzas? Añade una serie extra aquí.",
        cssAnchor: ".set-btn",
      },
    ],
  },
  {
    key: "training.moveExercise",
    screenId: "training.currentWorkout",
    level: 3,
    order: 7,
    autoStart: false,
    steps: [
      {
        key: "moveExercise",
        title: "Reordenar ejercicios",
        description: "Desde aquí puedes reordenar tus ejercicios.",
        cssAnchor: ".options-btn",
      },
    ],
  },
  {
    key: "training.moveSets",
    screenId: "training.currentWorkout",
    level: 3,
    order: 8,
    autoStart: false,
    steps: [
      {
        key: "moveSets",
        title: "Reordenar series",
        description: "Desde el menú de una serie puedes reordenarlas.",
        cssAnchor: ".options-btn",
      },
    ],
  },
  {
    key: "training.mesocycle",
    screenId: "training.mesocycle",
    level: 3,
    order: 9,
    autoStart: false,
    steps: [
      {
        key: "moveWorkouts",
        title: "Mover entrenamientos",
        description: "Reordena tus entrenamientos aquí.",
        cssAnchor: ".action-button",
      },
      {
        key: "microcycles",
        title: "Microciclos",
        description: "Cambia de microciclo y consulta tu progreso.",
        cssAnchor: ".microcycle-trigger",
      },
    ],
  },
  {
    key: "training.statistics",
    screenId: "training.statistics",
    level: 3,
    order: 10,
    autoStart: false,
    steps: [
      {
        key: "history",
        title: "Historial",
        description: "Aquí puedes ver tu historial y evolución.",
        cssAnchor: ".calendar-card",
      },
    ],
  },
];

async function seed() {
  const isDryRun = process.argv.includes("--dry-run");
  if (isDryRun) console.log("DRY RUN — no changes will be made");

  await mongoose.connect(buildMongoUri());
  console.log("Connected to MongoDB");

  let upserted = 0;
  for (const tutorial of TUTORIALS) {
    if (isDryRun) {
      console.log(`[DRY RUN] Upsert ${tutorial.key} (${tutorial.steps.length} steps)`);
      upserted += 1;
      continue;
    }

    await Tutorial.findOneAndUpdate(
      { key: tutorial.key },
      { $set: tutorial },
      { upsert: true, new: true },
    );
    upserted += 1;
  }

  console.log(`${isDryRun ? "Se actualizarían" : "Actualizados"} ${upserted} tutoriales`);
  await mongoose.disconnect();
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
