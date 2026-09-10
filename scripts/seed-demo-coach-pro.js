const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const crypto = require("crypto");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

/**
 * DATOS DE DEMO para todo lo construido en Coach Pro (7 fases + 5
 * movimientos): Cartera, alertas, adherencia, calculadora corporal, dolor,
 * intercambios, suplementos, lista de la compra, puntuaciones de ejercicio,
 * panel de carga de sesión, microciclos con objetivo y descarga...
 *
 * POR QUÉ ESTE SCRIPT ES ASÍ DE PARANOICO
 * Corre contra la base `pre` de Atlas, que es un entorno compartido con
 * cuentas reales dentro. Así que:
 *
 *   1. Todo lo que crea lleva un _id DETERMINISTA derivado de una semilla de
 *      texto (ver `oid`). Volver a ejecutarlo no duplica nada: reescribe los
 *      mismos documentos.
 *   2. Los clientes de demo usan el dominio @demo.trainfit.local, que no
 *      existe. Ningún correo real puede colisionar.
 *   3. `--clean` borra EXACTAMENTE lo que este script inserta, ni un
 *      documento más. No hace deleteMany sobre colecciones enteras.
 *
 * USO
 *   node scripts/seed-demo-coach-pro.js              -> siembra
 *   node scripts/seed-demo-coach-pro.js --clean      -> borra la demo
 *   node scripts/seed-demo-coach-pro.js --trainer=<id>
 *
 * Los tres clientes cuentan tres historias distintas a propósito, para que
 * la Cartera y el panel de alertas tengan algo que ordenar y priorizar:
 *   - Lucía  -> va bien: adherencia alta, peso bajando, sin dolor.
 *   - Marcos -> estancado 4 semanas CUMPLIENDO, y con la rodilla por encima
 *               de su umbral. Es el caso en que el entrenador tiene que
 *               cambiar la estrategia, no regañar.
 *   - Elena  -> descolgándose: sin check-in en 3 semanas, adherencia baja.
 */

const DOMINIO_DEMO = "demo.trainfit.local";
const PASSWORD_DEMO = "Demo1234!";
const TRAINER_POR_DEFECTO = "6a86feb4a4a80dd5286b0595"; // Santiago González

// ObjectId estable a partir de un texto. Es lo que hace el script
// idempotente y el borrado exacto.
function oid(semilla) {
  const hex = crypto.createHash("md5").update("tf-demo:" + semilla).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

const HOY = new Date();
function hace(dias) {
  return new Date(HOY.getTime() - dias * 86400000);
}
function isoHace(dias) {
  return hace(dias).toISOString().slice(0, 10);
}

// --- Los tres clientes ---
const CLIENTES = [
  {
    clave: "lucia",
    name: "Lucía",
    lastname: "Márquez (demo)",
    sex: 0,
    height: 166,
    birth: new Date("1994-04-12"),
    pesoInicial: 68.4,
    // Baja constante: ~350 g/semana.
    pesoPorSemana: -0.35,
    adherencia: "alta",
    // Tasas explícitas en vez de un flag alto/bajo: con solo dos niveles,
    // Lucía y Marcos salían con LA MISMA fila en la Cartera (92 · 81/100/
    // 88/100), que parece un fallo de copiado. Y Marcos quedaba a 1 punto
    // del umbral de estancamiento (minAdherencePct: 80), así que cualquier
    // retoque le apagaba su propia alerta.
    nutricionPct: 93,
    habitosPct: 95,
    diasSinCheckin: 2,
  },
  {
    clave: "marcos",
    name: "Marcos",
    lastname: "Rivas (demo)",
    sex: 1,
    height: 178,
    birth: new Date("1989-09-30"),
    pesoInicial: 84.2,
    // Estancado: se mueve menos del 0,5% en 4 semanas. Con adherencia alta,
    // eso dispara la señal de estancamiento (y NO la de baja adherencia).
    pesoPorSemana: -0.03,
    adherencia: "alta",
    // Cumple con la comida y no falta a un entrenamiento, pero descuida los
    // hábitos — coherente con sus check-ins de cansancio y mal sueño. Sigue
    // holgadamente por encima de 80, que es lo que exige el estancamiento.
    nutricionPct: 88,
    habitosPct: 68,
    diasSinCheckin: 4,
  },
  {
    clave: "elena",
    name: "Elena",
    lastname: "Torres (demo)",
    sex: 0,
    height: 171,
    birth: new Date("1997-01-22"),
    pesoInicial: 74.0,
    pesoPorSemana: 0.15,
    adherencia: "baja",
    nutricionPct: 30,
    habitosPct: 33,
    // Más de dos ciclos semanales vencidos -> check-in vencido crítico.
    diasSinCheckin: 23,
  },
];

/**
 * Reparte "cumplido / no cumplido" de forma determinista para que la tasa
 * real se acerque al porcentaje pedido.
 *
 * No usa Math.random: el script tiene que poder ejecutarse dos veces y dejar
 * exactamente la misma base, o `--clean` dejaría restos y la demo cambiaría
 * de números cada vez que se resiembra.
 */
function cumpleSegunTasa(indice, porcentaje) {
  // Mezcla entera. Dos trampas ya pisadas aquí:
  //   - `(i * 37) % 100` no reparte uniforme con índices en progresión
  //     aritmética como los de este script (pedí 88% y salía 80% clavado).
  //   - los operadores de bits de JS trabajan en int32 CON SIGNO, así que
  //     sin el `>>> 0` final la mitad de los valores salían negativos, y
  //     `negativo < porcentaje` es siempre cierto: Elena pedía 30% de
  //     adherencia y le salía 67%.
  let x = Math.imul(indice + 1, 2654435761);
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x = (x ^ (x >>> 16)) >>> 0;
  return (x % 100) < porcentaje;
}


function emailDe(c) {
  return `${c.clave}.demo@${DOMINIO_DEMO}`;
}
function idCliente(c) {
  return oid("user:" + c.clave);
}


// ---------------------------------------------------------------------------
// SIEMBRA
// ---------------------------------------------------------------------------

async function sembrarClientes(trainerId) {
  const User = require("../components/users/schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  const creados = [];

  for (const c of CLIENTES) {
    const _id = idCliente(c);
    await User.deleteOne({ _id });
    // create() y no updateOne(): el hook pre('save') del esquema es lo que
    // cifra la contraseña. Con updateOne se guardaría en claro.
    const user = await User.create({
      _id,
      name: c.name,
      lastname: c.lastname,
      email: emailDe(c),
      password: PASSWORD_DEMO,
      status: "active",
      roles: ["user"],
      sex: c.sex,
      height: c.height,
      birth: c.birth,
      weight: c.pesoInicial + c.pesoPorSemana * 11,
      activity: 1.45,
      objetive: c.adherencia === "alta" ? -300 : -200,
      training: 1.5,
      steps: 8000,
      theme: "dark",
      lang: "es",
    });

    // Las dos relaciones: entrenamiento y nutrición. Así la ficha enseña las
    // dos subpestañas de Plan y la adherencia puede promediar de verdad.
    for (const scope of ["training", "nutrition"]) {
      await TrainerClient.updateOne(
        { _id: oid(`rel:${c.clave}:${scope}`) },
        {
          $set: {
            trainerId,
            clientId: _id,
            clientEmail: emailDe(c),
            scope,
            status: "active",
            acceptedAt: hace(120),
          },
        },
        { upsert: true }
      );
    }

    creados.push({ ...c, _id, user });
    console.log(`   cliente ${c.name} ${c.lastname} -> ${_id}`);
  }
  return creados;
}

async function sembrarAntropometria(clientes) {
  const Anthropometry = require("../components/anthropometry/anthropometry-schema");
  const Model = mongoose.models.Anthropometry || mongoose.model("Anthropometry", Anthropometry);

  let total = 0;
  for (const c of clientes) {
    // 12 mediciones semanales. Los perímetros acompañan al peso para que la
    // calculadora corporal y los índices de proporción tengan de qué tirar.
    for (let semana = 11; semana >= 0; semana--) {
      const idx = 11 - semana;
      const peso = Math.round((c.pesoInicial + c.pesoPorSemana * idx) * 10) / 10;
      // Ruido de báscula: sin él, la serie es una recta perfecta y no se
      // parece a nada real.
      const ruido = ((idx * 7919) % 7) / 10 - 0.3;
      const factor = (peso - c.pesoInicial) * 0.35;

      await Model.updateOne(
        { _id: oid(`antro:${c.clave}:${semana}`) },
        {
          $set: {
            userId: c._id,
            date: isoHace(semana * 7),
            weight: Math.round((peso + ruido) * 10) / 10,
            neck: Math.round((c.sex === 1 ? 39 : 32) * 10) / 10,
            shoulders: c.sex === 1 ? 121 : 104,
            chest: Math.round(((c.sex === 1 ? 104 : 92) + factor * 0.4) * 10) / 10,
            waist: Math.round(((c.sex === 1 ? 88 : 74) + factor) * 10) / 10,
            abdomen: Math.round(((c.sex === 1 ? 92 : 80) + factor) * 10) / 10,
            hip: Math.round(((c.sex === 1 ? 99 : 100) + factor * 0.6) * 10) / 10,
            bicepsRelaxedL: c.sex === 1 ? 33.5 : 27.5,
            bicepsRelaxedR: c.sex === 1 ? 34 : 27.8,
            bicepsContractedL: c.sex === 1 ? 37.5 : 29.5,
            bicepsContractedR: c.sex === 1 ? 38 : 29.8,
            quadL: c.sex === 1 ? 59 : 56,
            quadR: c.sex === 1 ? 59.5 : 56.2,
            thighRelaxed: c.sex === 1 ? 61 : 58,
            thighContracted: c.sex === 1 ? 63 : 59.5,
            calfL: c.sex === 1 ? 38.5 : 35,
            calfR: c.sex === 1 ? 38.5 : 35.2,
            ankleL: c.sex === 1 ? 23 : 21,
            ankleR: c.sex === 1 ? 23 : 21,
            // Bioimpedancia solo en Lucía: así la calculadora enseña el caso
            // "Medido" compitiendo con las fórmulas estimadas, y en los
            // otros dos solo las estimaciones.
            ...(c.clave === "lucia"
              ? {
                  fatMass: Math.round((peso * 0.27 + factor * 0.5) * 10) / 10,
                  muscleMass: Math.round(peso * 0.38 * 10) / 10,
                  boneMass: 2.6,
                  residualMass: Math.round(peso * 0.24 * 10) / 10,
                }
              : {}),
          },
        },
        { upsert: true }
      );
      total++;
    }
  }
  console.log(`   ${total} mediciones antropométricas`);
}

async function sembrarCheckins(trainerId, clientes) {
  const CheckinSchedule = require("../components/trainerCheckins/checkin-schedule-schema");
  const CheckinRequest = require("../components/trainerCheckins/checkin-request-schema");
  const CheckinResponse = require("../components/trainerCheckins/checkin-response-schema");
  const WeightPlan = require("../components/weightPlans/weight-plan-schema");

  // Campos activados: mezcla de composición, perímetros y bienestar, con el
  // color de orina incluido para que se vea la escala de 8 niveles.
  const CAMPOS = [
    "weight", "perimeter_waist", "perimeter_navel", "perimeter_chest", "perimeter_hip",
    "recovery_between_sessions", "training_adherence", "hunger_satiety",
    "stress_level", "sleep_quality", "general_fatigue", "urine_color",
    "sleep_hours", "daily_steps", "nutrition_plan_adherence", "comment",
  ];

  // Preguntas PROPIAS del entrenador (Fase 5), una por cliente y de un tipo
  // distinto cada una para que se vean los seis que admite el sistema. El
  // _id se fija a mano porque la respuesta viaja en `values` bajo la clave
  // `custom:<idPregunta>` (checkin-custom-question.js#customKeyFor): sin un
  // id estable, resembrar dejaría las respuestas viejas apuntando a
  // preguntas que ya no existen.
  const PREGUNTAS = {
    lucia: { label: "¿Cómo has llevado las comidas fuera de casa?", type: "select",
             options: ["Ninguna", "Una", "Dos o más"], required: false },
    marcos: { label: "¿Cómo va la rodilla esta semana?", type: "scale_1_5", required: true },
    elena: { label: "¿Has podido entrenar las tres sesiones?", type: "yes_no", required: true },
  };
  // Las respuestas, en el mismo orden que los check-ins (i = 0 es el último).
  const RESPUESTAS_PROPIAS = {
    lucia: ["Una", "Ninguna", "Dos o más", "Ninguna"],
    marcos: [3, 2, 2, 3],
    elena: [false, false, true, false],
  };

  // Qué estado tiene cada ocurrencia (i = 0 es la más reciente). Sin esto la
  // bandeja "Por revisar" sale vacía y la adherencia de check-ins no puede
  // calcularse: se cuenta sobre solicitudes reales, no sobre una cadencia.
  const ESTADOS = {
    // Va al día: solo la última espera respuesta del entrenador.
    lucia: ["responded", "reviewed", "reviewed", "reviewed", "reviewed", "reviewed", "reviewed", "reviewed"],
    // Cumple pero arrastra fatiga: dos seguidas sin revisar es justo el caso
    // en el que el entrenador tiene que sentarse a decidir algo.
    marcos: ["responded", "responded", "reviewed", "reviewed", "reviewed", "reviewed", "reviewed", "reviewed"],
    // Se está descolgando: dos se le cerraron sin contestar.
    elena: ["unanswered", "unanswered", "reviewed", "reviewed", "reviewed", "reviewed", "reviewed", "reviewed"],
  };
  const REVISIONES = {
    lucia: "Semana redonda. Mantenemos cargas y subimos 100 kcal el fin de semana.",
    marcos: "El peso no se mueve pero el sueño ha empeorado. Antes de tocar la dieta, dos semanas cuidando el descanso.",
    elena: "Cuando puedas, cuéntame qué te está costando más y lo ajustamos.",
  };

  let respuestas = 0;
  let solicitudes = 0;
  for (const c of clientes) {
    const preguntaId = oid("q:" + c.clave);
    await CheckinSchedule.updateOne(
      { _id: oid(`chkcfg:${c.clave}`) },
      {
        $set: {
          trainerId, clientId: c._id, enabledFields: CAMPOS, sourceTemplateId: null,
          name: "Check-in semanal", startDate: new Date().toISOString().slice(0, 10),
          time: "09:00", timeZone: "Europe/Madrid", frequency: "weekly", interval: 1, active: true,
          customQuestions: [{ _id: preguntaId, enabled: true, unit: "", options: [], ...PREGUNTAS[c.clave] }],
        },
      },
      { upsert: true }
    );

    const alta = c.adherencia === "alta";
    // El comentario tiene que decir lo mismo que las métricas. Marcos lleva
    // fatiga 4 y sueño 3: si además escribiera "semana buena, sin problemas"
    // el entrenador leería una ficha que se contradice a sí misma.
    const comentarios = c.clave === "marcos"
      ? [
          "Las sesiones las hago todas, pero llego arrastrando.",
          "Duermo mal desde hace semanas y se nota en el gimnasio.",
          "Cumpliendo la dieta al pie de la letra y la báscula no se mueve.",
          "Sin fuerzas para subir peso. Voy justo.",
        ]
      : alta
        ? ["Semana buena, sin problemas.", "Me costó el jueves pero cumplí.", "Con energía, subí peso en sentadilla.", "Todo bien."]
        : ["Semana complicada de trabajo.", "Comí fuera tres veces.", "No entrené el finde.", "Ha sido un desastre, lo siento."];

    // Se generan hacia atrás desde el último check-in real de cada cliente.
    for (let i = 0; i < 8; i++) {
      const diasAtras = c.diasSinCheckin + i * 7;
      if (diasAtras > 80) break;

      const v = alta
        ? { recovery_between_sessions: 4, training_adherence: 5, hunger_satiety: 3, stress_level: 2, sleep_quality: 4, general_fatigue: 2, nutrition_plan_adherence: 4, urine_color: 3, sleep_hours: 7.5, daily_steps: 9200 }
        : { recovery_between_sessions: 2, training_adherence: 2, hunger_satiety: 2, stress_level: 4, sleep_quality: 2, general_fatigue: 4, nutrition_plan_adherence: 2, urine_color: 6, sleep_hours: 5.5, daily_steps: 4100 };

      // Marcos: cumple pero arrastra fatiga y duerme peor. Es lo que hace que
      // su estancamiento se lea como "toca cambiar algo", no como dejadez.
      if (c.clave === "marcos") { v.general_fatigue = 4; v.sleep_quality = 3; v.recovery_between_sessions = 2; }

      const estado = ESTADOS[c.clave][i] || "reviewed";
      const contestada = estado === "responded" || estado === "reviewed";
      const valores = {
        ...v,
        comment: comentarios[i % comentarios.length],
        // Misma bolsa Mixed que los campos del catálogo: el prefijo
        // "custom:" es lo que las distingue, sin colección aparte.
        ["custom:" + preguntaId]: RESPUESTAS_PROPIAS[c.clave][i % 4],
      };

      // La solicitud es el registro canónico: de aquí salen la bandeja de
      // revisión, la adherencia y el calendario. La respuesta es su
      // proyección, y comparte _id (igual que projectAnswer en producción).
      await CheckinRequest.updateOne(
        { _id: oid(`chk:${c.clave}:${i}`) },
        {
          $set: {
            trainerId, clientId: c._id, scheduleId: oid(`chkcfg:${c.clave}`),
            occurrenceKey: `seed:${c.clave}:${i}`,
            name: "Check-in semanal", enabledFields: CAMPOS,
            customQuestions: [{ _id: preguntaId, enabled: true, unit: "", options: [], ...PREGUNTAS[c.clave] }],
            scheduledAt: hace(diasAtras), closesAt: hace(diasAtras - 7), timeZone: "Europe/Madrid",
            status: estado,
            values: contestada ? valores : {},
            respondedAt: contestada ? hace(diasAtras) : null,
            reviewedAt: estado === "reviewed" ? hace(Math.max(0, diasAtras - 1)) : null,
            reviewComment: estado === "reviewed" ? REVISIONES[c.clave] : "",
            seenByTrainer: estado === "reviewed",
          },
        },
        { upsert: true }
      );
      solicitudes++;

      if (!contestada) continue;

      await CheckinResponse.updateOne(
        { _id: oid(`chk:${c.clave}:${i}`) },
        {
          $set: {
            trainerId, clientId: c._id, scheduleId: oid(`chkcfg:${c.clave}`),
            name: "Check-in semanal", respondedAt: hace(diasAtras),
            values: valores,
            status: estado,
            reviewedAt: estado === "reviewed" ? hace(Math.max(0, diasAtras - 1)) : null,
            reviewComment: estado === "reviewed" ? REVISIONES[c.clave] : "",
            customQuestions: [{ _id: preguntaId, enabled: true, unit: "", options: [], ...PREGUNTAS[c.clave] }],
            seenByTrainer: estado === "reviewed",
          },
        },
        { upsert: true }
      );
      respuestas++;
    }
    // Elena tiene además una solicitud abierta AHORA: se le acaba de pedir y
    // todavía está a tiempo. Es lo que distingue "no ha contestado todavía"
    // de "se le cerró sin contestar", que la pantalla trata distinto.
    if (c.clave === "elena") {
      await CheckinRequest.updateOne(
        { _id: oid(`chk:${c.clave}:abierta`) },
        {
          $set: {
            trainerId, clientId: c._id, scheduleId: oid(`chkcfg:${c.clave}`),
            occurrenceKey: `seed:${c.clave}:abierta`,
            name: "Check-in semanal", enabledFields: CAMPOS,
            customQuestions: [{ _id: preguntaId, enabled: true, unit: "", options: [], ...PREGUNTAS[c.clave] }],
            scheduledAt: hace(2), closesAt: hace(-5), timeZone: "Europe/Madrid",
            status: "pending", values: {}, respondedAt: null,
          },
        },
        { upsert: true }
      );
      solicitudes++;
    }

    // Pauta de peso: cada cliente con un ritmo distinto, para que se vea la
    // diferencia entre ir al día y arrastrar retraso.
    await WeightPlan.updateOne(
      { _id: oid(`peso:${c.clave}`) },
      {
        $set: {
          trainerId, clientId: c._id,
          intervalDays: c.clave === "lucia" ? 2 : c.clave === "marcos" ? 3 : 7,
          notes: "", lastReminderSentAt: null,
        },
      },
      { upsert: true }
    );
  }
  console.log(`   ${solicitudes} solicitudes y ${respuestas} respuestas de check-in`);
}

async function sembrarDolor(clientes) {
  const { PainEntry, PainThreshold } = require("../components/painLog/pain-schema");
  const marcos = clientes.find((c) => c.clave === "marcos");
  const lucia = clientes.find((c) => c.clave === "lucia");
  let n = 0;

  // Marcos: rodilla derecha que empeoró y ahora mejora. La serie enseña la
  // tendencia ("va a mejor") y el máximo del periodo dispara el aviso.
  const rodilla = [3, 4, 5, 6, 7, 6, 5, 4, 4, 3];
  for (let i = 0; i < rodilla.length; i++) {
    await PainEntry.updateOne(
      { _id: oid(`pain:marcos:rodilla:${i}`) },
      { $set: { userId: marcos._id, date: isoHace((rodilla.length - 1 - i) * 2), zone: "Rodilla der.", level: rodilla[i], note: i < 5 ? "Al bajar en sentadilla profunda" : "Ya casi no lo noto" } },
      { upsert: true }
    );
    n++;
  }
  // Y una molestia menor y puntual, para que no todo sea la rodilla.
  for (let i = 0; i < 3; i++) {
    await PainEntry.updateOne(
      { _id: oid(`pain:marcos:lumbar:${i}`) },
      { $set: { userId: marcos._id, date: isoHace(i * 3 + 1), zone: "Espalda baja", level: 2, note: "" } },
      { upsert: true }
    );
    n++;
  }
  // Lucía: hombro que ya está a cero. El 0 es un dato — enseña que se cerró.
  for (let i = 0; i < 4; i++) {
    await PainEntry.updateOne(
      { _id: oid(`pain:lucia:hombro:${i}`) },
      { $set: { userId: lucia._id, date: isoHace(i * 5 + 1), zone: "Hombro izq.", level: i === 3 ? 3 : i === 2 ? 2 : i === 1 ? 1 : 0, note: "" } },
      { upsert: true }
    );
    n++;
  }

  // Umbrales que fija el ENTRENADOR. Sin ellos, un 6 no dice qué hacer.
  await PainThreshold.updateOne(
    { _id: oid("painthr:marcos:rodilla") },
    { $set: { trainerId: marcos.trainerId, clientId: marcos._id, zone: "Rodilla der.", workLevel: 3, painLevel: 5, note: "Hasta 3 entrena normal. De 5 en adelante, fuera sentadilla profunda y prensa." } },
    { upsert: true }
  );
  await PainThreshold.updateOne(
    { _id: oid("painthr:lucia:hombro") },
    { $set: { trainerId: lucia.trainerId, clientId: lucia._id, zone: "Hombro izq.", workLevel: 2, painLevel: 4, note: "Sin press militar por encima de 2." } },
    { upsert: true }
  );

  console.log(`   ${n} registros de dolor + 2 umbrales`);
}

// Ejercicios reales del catálogo, elegidos para que las puntuaciones
// músculo/articulación tengan sentido y el panel de carga reparta bien.
const EJERCICIOS_DEMO = [
  { id: "65ca4135c595b8b7d15098d9", nombre: "Press plano en máquina", musculos: [["Pectoral", 3], ["Tríceps", 2], ["Deltoides anterior", 2]], articulaciones: [["Hombro", 2], ["Codo", 1]], segundos: 45 },
  { id: "65ca4135c595b8b7d15098f1", nombre: "Remo gironda", musculos: [["Espalda alta", 3], ["Bíceps", 2], ["Deltoides posterior", 1]], articulaciones: [["Codo", 1], ["Hombro", 1]], segundos: 40 },
  { id: "65ca4135c595b8b7d1509916", nombre: "Zancadas en multipower", musculos: [["Cuádriceps", 3], ["Glúteo", 3], ["Femoral", 1]], articulaciones: [["Rodilla", 3], ["Cadera", 2]], segundos: 60 },
  { id: "65ca4135c595b8b7d1509952", nombre: "Peso muerto sumo", musculos: [["Femoral", 3], ["Glúteo", 3], ["Espalda baja", 2], ["Espalda alta", 1]], articulaciones: [["Columna lumbar", 3], ["Cadera", 2], ["Rodilla", 1]], segundos: 55 },
  { id: "65ca4135c595b8b7d1509936", nombre: "Pájaros con mancuernas banco inclinado", musculos: [["Deltoides posterior", 3], ["Espalda alta", 1]], articulaciones: [["Hombro", 1]], segundos: 35 },
];

async function sembrarPuntuaciones(trainerId) {
  const ExerciseScore = require("../components/exerciseScores/exercise-score-schema");
  for (const e of EJERCICIOS_DEMO) {
    await ExerciseScore.updateOne(
      { _id: oid("score:" + e.id) },
      {
        $set: {
          trainerId,
          exerciseId: new mongoose.Types.ObjectId(e.id),
          muscleScores: e.musculos.map(([name, score]) => ({ name, score })),
          jointScores: e.articulaciones.map(([name, score]) => ({ name, score })),
          secondsPerSet: e.segundos,
        },
      },
      { upsert: true }
    );
  }
  console.log("   " + EJERCICIOS_DEMO.length + " ejercicios puntuados (IEM/IEA)");
}

async function sembrarRutinas(trainerId, clientes) {
  const Table = require("../components/tables/table-schema");
  const Split = require("../components/splits/split-schema");
  const Workout = require("../components/workouts/workout-schema");
  const CustomExercise = require("../components/customExercises/custom-exercise-schema");
  const SetModel = require("../components/sets/set-schema");
  const User = require("../components/users/schema");

  // Cuatro microciclos: dos de acumulación, uno de intensificación y una
  // DESCARGA. Es lo que da sentido a la comparación bloque a bloque — en la
  // descarga el volumen baja a propósito, y sin marcarla parecería un bajón.
  const MICROCICLOS = [
    { nombre: "Semana 1 · Base", purpose: "accumulation", objective: "Subir series de espalda sin tocar pierna.", factor: 1 },
    { nombre: "Semana 2 · Acumulación", purpose: "accumulation", objective: "Mantener técnica subiendo 2,5 kg en básicos.", factor: 1.12 },
    { nombre: "Semana 3 · Intensificación", purpose: "intensification", objective: "Menos series, más carga. RIR 1 en la última.", factor: 1.2 },
    { nombre: "Semana 4 · Descarga", purpose: "deload", objective: "Bajar volumen a la mitad. Que llegue fresco al siguiente bloque.", factor: 0.55 },
  ];

  const SESIONES = [
    { nombre: "Torso A", ejercicios: [0, 1, 4] },
    { nombre: "Pierna A", ejercicios: [2, 3] },
    { nombre: "Torso B", ejercicios: [1, 0] },
  ];

  let nSets = 0;
  for (const c of clientes) {
    const splitIds = [];

    for (let m = 0; m < MICROCICLOS.length; m++) {
      const micro = MICROCICLOS[m];
      const workoutIds = [];

      for (let s = 0; s < SESIONES.length; s++) {
        const ses = SESIONES[s];
        // El microciclo 0 es el más antiguo. Cada uno dura 7 días.
        const diasAtras = (MICROCICLOS.length - 1 - m) * 7 + (SESIONES.length - 1 - s) * 2;
        // Elena entrena menos: se salta la tercera sesión de cada semana.
        const entrenado = c.adherencia === "alta" || s < 2;
        const exIds = [];

        for (const idxEj of ses.ejercicios) {
          const ej = EJERCICIOS_DEMO[idxEj];
          const setIds = [];
          const nSeries = micro.purpose === "deload" ? 2 : 4;
          const esBasico = idxEj === 2 || idxEj === 3;

          for (let k = 0; k < nSeries; k++) {
            const setId = oid("set:" + c.clave + ":" + m + ":" + s + ":" + idxEj + ":" + k);
            const pesoBase = (c.sex === 1 ? 60 : 35) + idxEj * 5;
            const doc = {
              order: k,
              expectedReps: [8, 10],
              expectedRir: [2, 1],
              restSeconds: esBasico ? 150 : 90,
            };
            if (entrenado) {
              doc.reps = 8 + (k % 3);
              doc.weight = Math.round((pesoBase * micro.factor + k * 2.5) * 2) / 2;
              doc.rir = [2];
              doc.doned = true;
              doc.donedAt = hace(diasAtras);
            }
            await SetModel.updateOne({ _id: setId }, { $set: doc }, { upsert: true });
            setIds.push(setId);
            nSets++;
          }

          const exId = oid("cex:" + c.clave + ":" + m + ":" + s + ":" + idxEj);
          const exDoc = {
            order: exIds.length,
            exercise: new mongoose.Types.ObjectId(ej.id),
            sets: setIds,
          };
          // Nota del ENTRENADOR y nota del CLIENTE, separadas (Movimiento 2).
          // Antes compartían campo y la última en escribirse borraba la otra.
          if (idxEj === 2 && c.clave === "marcos") {
            exDoc.notes = "Profundidad hasta donde no moleste la rodilla.";
            exDoc.clientNotes = "Hoy la rodilla iba mejor, bajé más.";
          }
          if (idxEj === 0 && c.clave === "lucia") {
            exDoc.notes = "Codos a 45 grados, no los abras.";
          }
          await CustomExercise.updateOne({ _id: exId }, { $set: exDoc }, { upsert: true });
          exIds.push(exId);
        }

        const wId = oid("w:" + c.clave + ":" + m + ":" + s);
        const wDoc = { name: ses.nombre, exercises: exIds };
        if (entrenado) {
          wDoc.date = hace(diasAtras);
          wDoc.readinessPre = c.adherencia === "alta" ? (c.clave === "marcos" ? 3 : 4) : 2;
          wDoc.perceivedEffortPost = micro.purpose === "deload" ? 2 : 4;
          // Agujetas con las que LLEGÓ a la sesión (Movimiento 2): se
          // preguntan al empezar, no al terminar.
          if (c.clave === "marcos" && ses.nombre.indexOf("Pierna") === 0) {
            wDoc.sorenessPre = [{ muscle: "Cuádriceps", level: 4 }, { muscle: "Glúteo", level: 3 }];
          } else if (ses.nombre.indexOf("Torso") === 0) {
            wDoc.sorenessPre = [{ muscle: "Pectoral", level: 2 }];
          }
        }
        await Workout.updateOne({ _id: wId }, { $set: wDoc }, { upsert: true });
        workoutIds.push(wId);
      }

      const spId = oid("split:" + c.clave + ":" + m);
      await Split.updateOne(
        { _id: spId },
        { $set: { name: micro.nombre, objective: micro.objective, purpose: micro.purpose, workouts: workoutIds } },
        { upsert: true }
      );
      splitIds.push(spId);
    }

    const tId = oid("table:" + c.clave);
    await Table.updateOne(
      { _id: tId },
      { $set: { name: "Mesociclo hipertrofia (demo)", userId: c._id, assignedByTrainerId: trainerId, splits: splitIds } },
      { upsert: true }
    );
    await User.updateOne({ _id: c._id }, { $set: { tableInUse: tId } });
  }
  console.log("   " + clientes.length + " rutinas, 4 microciclos (1 descarga), " + nSets + " series");
}


// ---------------------------------------------------------------------------
// NUTRICIÓN
// ---------------------------------------------------------------------------

// Grupos de intercambio del ENTRENADOR. Llevan base numérica (Movimiento 5)
// para que la calculadora de etiquetas tenga con qué dividir. El sistema
// sigue sin inventar equivalencias: las cantidades las escribe él.
const GRUPOS_INTERCAMBIO = [
  {
    clave: "proteina",
    name: "Proteína magra",
    category: "Proteína",
    equivalenceNote: "Equivalen en PROTEÍNA (unos 20 g), no en calorías. La grasa cambia entre ellos.",
    basis: "protein",
    basisAmount: 20,
    items: [
      { name: "Pechuga de pollo", quantity: 100, unit: "g", note: "en crudo" },
      { name: "Pavo", quantity: 105, unit: "g", note: "en crudo" },
      { name: "Merluza", quantity: 115, unit: "g", note: "" },
      { name: "Atún al natural", quantity: 90, unit: "g", note: "escurrido" },
      { name: "Claras de huevo", quantity: 180, unit: "g", note: "" },
      { name: "Tofu firme", quantity: 160, unit: "g", note: "" },
    ],
  },
  {
    clave: "hidratos",
    name: "Hidratos",
    category: "Carbohidrato",
    equivalenceNote: "Equivalen en HIDRATOS (15 g por ración). Pesa siempre en crudo.",
    basis: "carbs",
    basisAmount: 15,
    items: [
      { name: "Arroz basmati", quantity: 20, unit: "g", note: "en crudo" },
      { name: "Pasta integral", quantity: 21, unit: "g", note: "en crudo" },
      { name: "Patata", quantity: 85, unit: "g", note: "" },
      { name: "Pan integral", quantity: 32, unit: "g", note: "" },
      { name: "Avena", quantity: 25, unit: "g", note: "" },
    ],
  },
  {
    clave: "grasa",
    name: "Grasas",
    category: "Grasa",
    equivalenceNote: "Equivalen en GRASA (10 g por ración).",
    basis: "fat",
    basisAmount: 10,
    items: [
      { name: "Aceite de oliva virgen extra", quantity: 11, unit: "ml", note: "" },
      { name: "Aguacate", quantity: 65, unit: "g", note: "" },
      { name: "Almendras", quantity: 18, unit: "g", note: "crudas" },
      { name: "Mantequilla de cacahuete", quantity: 20, unit: "g", note: "100% cacahuete" },
    ],
  },
  {
    // Sin base numérica a propósito: enseña que un grupo puede seguir siendo
    // una lista escrita a mano, como antes del Movimiento 5.
    clave: "verduras",
    name: "Verduras libres",
    category: "Verdura",
    equivalenceNote: "Cantidad libre. Son intercambiables entre sí sin pesar.",
    basis: null,
    basisAmount: null,
    items: [
      { name: "Brócoli", quantity: 200, unit: "g", note: "" },
      { name: "Calabacín", quantity: 200, unit: "g", note: "" },
      { name: "Espinacas", quantity: 150, unit: "g", note: "" },
      { name: "Pimiento", quantity: 200, unit: "g", note: "" },
    ],
  },
];

async function sembrarIntercambios(trainerId) {
  const FoodExchangeGroup = require("../components/foodExchanges/food-exchange-schema");
  const ids = {};
  for (const g of GRUPOS_INTERCAMBIO) {
    const _id = oid("exgrp:" + g.clave);
    await FoodExchangeGroup.updateOne(
      { _id },
      {
        $set: {
          trainerId,
          name: g.name,
          category: g.category,
          equivalenceNote: g.equivalenceNote,
          basis: g.basis,
          basisAmount: g.basisAmount,
          items: g.items,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );
    ids[g.clave] = { _id, name: g.name };
  }
  console.log("   " + GRUPOS_INTERCAMBIO.length + " grupos de intercambio (3 con base numérica)");
  return ids;
}

async function sembrarObjetivos(trainerId, clientes, grupos) {
  const NutritionalGoal = require("../components/nutritionalGoals/nutritional-goal-schema");
  const User = require("../components/users/schema");

  for (const c of clientes) {
    const kcal = c.sex === 1 ? 2450 : 1850;
    const doc = {
      userId: c._id,
      name: "Objetivo de " + c.name + " (demo)",
      kcalTotal: kcal,
      proteinsGTotal: Math.round((c.sex === 1 ? 84 : 68) * 2),
      carbohydratesGTotal: Math.round(kcal * 0.42 / 4),
      fatGTotal: Math.round(kcal * 0.28 / 9),
      fiberGTotal: 30,
      assignedByTrainerId: trainerId,
      startDate: isoHace(28),
      endMode: "indefinite",
      updatedAt: new Date(),
    };

    // Solo Lucía se pauta TAMBIÉN por intercambios repartidos por comida.
    // Los otros dos van en gramos: es la decisión del usuario de que las dos
    // formas convivan, y con los tres iguales no se vería.
    if (c.clave === "lucia") {
      doc.mealExchanges = [
        {
          name: "Desayuno",
          exchanges: [
            { groupId: grupos.hidratos._id, groupName: grupos.hidratos.name, count: 2 },
            { groupId: grupos.proteina._id, groupName: grupos.proteina.name, count: 1 },
            { groupId: grupos.grasa._id, groupName: grupos.grasa.name, count: 1 },
          ],
        },
        {
          name: "Comida",
          exchanges: [
            { groupId: grupos.proteina._id, groupName: grupos.proteina.name, count: 2 },
            { groupId: grupos.hidratos._id, groupName: grupos.hidratos.name, count: 3 },
            { groupId: grupos.grasa._id, groupName: grupos.grasa.name, count: 1 },
            { groupId: grupos.verduras._id, groupName: grupos.verduras.name, count: 1 },
          ],
        },
        {
          name: "Post-entreno",
          exchanges: [
            { groupId: grupos.proteina._id, groupName: grupos.proteina.name, count: 1.5 },
            { groupId: grupos.hidratos._id, groupName: grupos.hidratos.name, count: 2 },
          ],
        },
        {
          name: "Cena",
          exchanges: [
            { groupId: grupos.proteina._id, groupName: grupos.proteina.name, count: 2 },
            { groupId: grupos.grasa._id, groupName: grupos.grasa.name, count: 0.5 },
            { groupId: grupos.verduras._id, groupName: grupos.verduras.name, count: 1 },
          ],
        },
      ];
    }

    const _id = oid("goal:" + c.clave);
    await NutritionalGoal.updateOne({ _id }, { $set: doc }, { upsert: true });
    await User.updateOne({ _id: c._id }, { $set: { goalInUse: _id } });
  }
  console.log("   " + clientes.length + " objetivos nutricionales (1 con reparto por intercambios)");
}

// Comidas pautadas de los últimos 14 días. Alimentan tres cosas a la vez: la
// adherencia nutricional, el calendario de nutrición y la lista de la compra
// (que no es más que esto mismo sumado por producto).
// Los 12 alimentos del menú, con macros REALES por 100 g.
//
// No se cogen del catálogo global: son 53.000 productos importados de una
// fuente abierta, con nombres de marca y macros imposibles ("Almendras
// P67 HC67 G167", "Aceite de oliva 5.600 kcal"). Sembrar la demo con eso
// llenaría las gráficas de basura — justo lo que las cotas de
// plausibilidad del catálogo de check-in existen para evitar.
//
// Se crean como productos DEL ENTRENADOR (`userId`), no globales: la
// búsqueda del catálogo filtra por `userId: null` (product-dao.js:154), así
// que estos no aparecen para nadie más. Es además lo verosímil: un
// entrenador con sus propios alimentos dados de alta.
const ALIMENTOS = [
  // nombre, kcal, proteína, hidratos, grasa, fibra (por 100 g)
  // --- Proteína ---
  ["Pechuga de pollo", 165, 31, 0, 3.6, 0],
  ["Pavo", 135, 29, 0, 1.7, 0],
  ["Ternera magra", 158, 26, 0, 5.4, 0],
  ["Merluza", 86, 17.2, 0, 1.8, 0],
  ["Salmón", 208, 20, 0, 13.4, 0],
  ["Atún al natural", 116, 26, 0, 1, 0],
  ["Huevo entero", 143, 12.6, 0.7, 9.5, 0],
  ["Claras de huevo", 52, 10.9, 0.7, 0.2, 0],
  ["Yogur griego natural", 97, 9, 3.6, 5, 0],
  ["Queso fresco batido 0%", 47, 8, 3.9, 0.2, 0],
  ["Leche desnatada", 35, 3.4, 4.9, 0.1, 0],
  ["Proteína de suero", 380, 80, 6, 5, 0],
  // --- Hidratos ---
  ["Arroz basmati", 360, 7.5, 79, 0.9, 1.3],
  ["Arroz integral", 350, 7.9, 74, 2.9, 3.5],
  ["Pasta integral", 348, 13, 66, 2.5, 8],
  ["Avena en copos", 389, 16.9, 66.3, 6.9, 10.6],
  ["Pan integral", 247, 9.7, 41, 3.4, 7],
  ["Patata", 77, 2, 17.5, 0.1, 2.2],
  ["Boniato", 86, 1.6, 20.1, 0.1, 3],
  ["Quinoa", 368, 14.1, 64.2, 6.1, 7],
  ["Lentejas cocidas", 116, 9, 20.1, 0.4, 7.9],
  ["Garbanzos cocidos", 139, 8.9, 22.5, 2.6, 7.6],
  // --- Grasas ---
  ["Aceite de oliva virgen extra", 884, 0, 0, 100, 0],
  ["Almendras", 579, 21.2, 21.6, 49.9, 12.5],
  ["Nueces", 654, 15.2, 13.7, 65.2, 6.7],
  ["Aguacate", 160, 2, 8.5, 14.7, 6.7],
  ["Mantequilla de cacahuete", 588, 25.1, 20, 50.4, 6],
  // --- Verdura y fruta ---
  ["Brócoli", 34, 2.8, 6.6, 0.4, 2.6],
  ["Espinacas", 23, 2.9, 3.6, 0.4, 2.2],
  ["Tomate", 18, 0.9, 3.9, 0.2, 1.2],
  ["Cebolla", 40, 1.1, 9.3, 0.1, 1.7],
  ["Pimiento rojo", 31, 1, 6, 0.3, 2.1],
  ["Calabacín", 17, 1.2, 3.1, 0.3, 1],
  ["Plátano", 89, 1.1, 22.8, 0.3, 2.6],
  ["Manzana", 52, 0.3, 13.8, 0.2, 2.4],
  ["Arándanos", 57, 0.7, 14.5, 0.3, 2.4],
];

async function sembrarAlimentos(trainerId) {
  const Product = require("../components/products/product-schema");
  const porNombre = new Map();

  for (const [nombre, kcal, prot, hc, grasa, fibra] of ALIMENTOS) {
    const id = oid("prod:" + nombre);
    await Product.updateOne(
      { _id: id },
      {
        $set: {
          name: nombre,
          userId: trainerId,
          energyKcal100g: kcal,
          protein100g: prot,
          carbohydrates100g: hc,
          fat100g: grasa,
          fiber100g: fibra,
        },
      },
      { upsert: true }
    );
    porNombre.set(nombre, id);
  }

  console.log("   " + ALIMENTOS.length + " alimentos propios del entrenador");
  return porNombre;
}

const MENU = [
  { comida: "Desayuno", items: [["Avena en copos", 60], ["Claras de huevo", 200], ["Plátano", 120]] },
  { comida: "Comida", items: [["Pechuga de pollo", 180], ["Arroz basmati", 80], ["Brócoli", 200], ["Aceite de oliva virgen extra", 15]] },
  { comida: "Merienda", items: [["Yogur griego natural", 150], ["Almendras", 25]] },
  { comida: "Cena", items: [["Merluza", 200], ["Patata", 250], ["Espinacas", 150]] },
];

async function sembrarDietas(trainerId, clientes, alimentos) {
  const Diet = require("../components/diets/diet-schema");
  const DietDay = require("../components/dietDays/diet-days-schema");
  const Meal = require("../components/meals/meal-schema");
  const CustomProduct = require("../components/customProducts/custom-product-schema");
  const User = require("../components/users/schema");

  let nDias = 0;
  for (const c of clientes) {
    const dayIds = [];
    // 14 días atrás y 7 hacia delante: la lista de la compra mira HACIA
    // DELANTE (qué comprar), y la adherencia hacia atrás.
    for (let d = 13; d >= -7; d--) {
      const fecha = isoHace(d);
      const mealIds = [];

      for (let mi = 0; mi < MENU.length; mi++) {
        const m = MENU[mi];
        const cpIds = [];
        for (let ii = 0; ii < m.items.length; ii++) {
          const [nombre, cantidad] = m.items[ii];
          const cpId = oid("cp:" + c.clave + ":" + d + ":" + mi + ":" + ii);
          await CustomProduct.updateOne(
            { _id: cpId },
            {
              $set: {
                // CustomProduct NO tiene campo `name`: el nombre y los
                // macros salen del Product enlazado (ver
                // diet-days-nutrition-util.js#ingredientMacros, que cae a
                // `.product` cuando el item no trae copia propia). Sin este
                // enlace la dieta sale sin nombres y a 0 kcal.
                product: alimentos.get(nombre),
                mealId: oid("meal:" + c.clave + ":" + d + ":" + mi),
                quantity: cantidad,
                order: ii,
                assignedByTrainerId: trainerId,
                // Consumido según la adherencia del cliente, y solo en días
                // pasados: el futuro todavía no se ha comido.
                consumed: d > 0 && cumpleSegunTasa((d * 4 + mi) * 4 + ii, c.nutricionPct),
              },
            },
            { upsert: true }
          );
          cpIds.push(cpId);
        }

        const mealId = oid("meal:" + c.clave + ":" + d + ":" + mi);
        await Meal.updateOne(
          { _id: mealId },
          { $set: { name: m.comida, customProducts: cpIds, assignedByTrainerId: trainerId, trainerId } },
          { upsert: true }
        );
        mealIds.push(mealId);
      }

      const dayId = oid("dd:" + c.clave + ":" + d);
      await DietDay.updateOne(
        { _id: dayId },
        { $set: { date: fecha, meals: mealIds, steps: c.adherencia === "alta" ? 9000 : 4200 } },
        { upsert: true }
      );
      dayIds.push(dayId);
      nDias++;
    }

    const dietId = oid("diet:" + c.clave);
    await Diet.updateOne(
      { _id: dietId },
      { $set: { name: "Plan de " + c.name + " (demo)", dietsDay: dayIds } },
      { upsert: true }
    );
    await User.updateOne({ _id: c._id }, { $set: { dietInUse: dietId } });
  }
  console.log("   " + nDias + " días de dieta pautados (14 atrás + 7 adelante)");
}

async function sembrarSuplementos(trainerId, clientes) {
  const { Supplement } = require("../components/supplements/supplement-schema");
  const PAUTAS = {
    lucia: [
      { name: "Creatina monohidrato", dose: "5 g", timing: "post_workout", reason: "Rendimiento en series de fuerza. Toma diaria, también los días de descanso.", purchaseUrl: "https://www.hsnstore.com/", weekdays: [] },
      { name: "Vitamina D3", dose: "2000 UI", timing: "breakfast", reason: "Analítica de enero por debajo de rango. Revisar en la próxima.", purchaseUrl: "", weekdays: [] },
    ],
    marcos: [
      { name: "Creatina monohidrato", dose: "5 g", timing: "post_workout", reason: "Mantener rendimiento durante el estancamiento.", purchaseUrl: "https://www.hsnstore.com/", weekdays: [] },
      { name: "Colágeno + vitamina C", dose: "10 g", timing: "pre_workout", reason: "Por la rodilla. Tomar 40 min antes de entrenar pierna.", purchaseUrl: "", weekdays: [1, 4] },
      { name: "Magnesio bisglicinato", dose: "300 mg", timing: "before_bed", reason: "Duermes mal y arrastras fatiga. Probamos 3 semanas y valoramos.", purchaseUrl: "", weekdays: [] },
    ],
    elena: [
      { name: "Proteína de suero", dose: "1 cazo (30 g)", timing: "custom", customTiming: "Cuando no llegues a la proteína del día", reason: "No es obligatorio: es una red de seguridad los días que comes fuera.", purchaseUrl: "", weekdays: [] },
    ],
  };

  let n = 0;
  for (const c of clientes) {
    const pautas = PAUTAS[c.clave] || [];
    for (let i = 0; i < pautas.length; i++) {
      const p = pautas[i];
      await Supplement.updateOne(
        { _id: oid("supp:" + c.clave + ":" + i) },
        { $set: { trainerId, clientId: c._id, active: true, customTiming: "", ...p } },
        { upsert: true }
      );
      n++;
    }
  }
  console.log("   " + n + " suplementos pautados");
}


// ---------------------------------------------------------------------------
// SEGUIMIENTO: hábitos, notas, cobros
// ---------------------------------------------------------------------------

async function sembrarHabitos(trainerId, clientes) {
  const TrainerTask = require("../components/trainerTasks/trainer-task-schema");
  const TaskCompletion = require("../components/trainerTasks/task-completion-schema");
  const HABITOS = [
    { type: "steps", label: null, target: 9000, unit: "pasos" },
    { type: "water", label: null, target: 2.5, unit: "l" },
    { type: "sleep", label: null, target: 7.5, unit: "h" },
  ];

  let nTareas = 0;
  let nMarcas = 0;
  for (const c of clientes) {
    for (let i = 0; i < HABITOS.length; i++) {
      const taskId = oid("task:" + c.clave + ":" + i);
      await TrainerTask.updateOne(
        { _id: taskId },
        // createdAt hacia atrás: las marcas son de los últimos 28 días y un
        // hábito no puede tener marcas anteriores a su propia creación (la
        // adherencia las descarta y saldría "16 de 2 días").
        { $set: { trainerId, clientId: c._id, active: true, createdAt: hace(40), ...HABITOS[i] } },
        { upsert: true }
      );
      nTareas++;

      // Cumplimiento de los últimos 28 días, acorde a la adherencia. Es lo
      // que hace que la dimensión "hábitos" tenga un porcentaje creíble.
      for (let d = 0; d < 28; d++) {
        const cumple = cumpleSegunTasa(d * 3 + i, c.habitosPct);
        if (!cumple) continue;
        await TaskCompletion.updateOne(
          { _id: oid("taskc:" + c.clave + ":" + i + ":" + d) },
          { $set: { taskId, date: isoHace(d), completed: true, completedAt: hace(d) } },
          { upsert: true }
        );
        nMarcas++;
      }
    }
  }
  console.log("   " + nTareas + " hábitos y " + nMarcas + " marcas de cumplimiento");
}

async function sembrarNotasYCobros(trainerId, clientes) {
  const TrainerNote = require("../components/trainerNotes/trainer-note-schema");
  const TrainerPayment = require("../components/trainerPayments/trainer-payment-schema");

  const NOTAS = {
    lucia: [
      { text: "Viaja por trabajo la primera semana de cada mes. Ajustar volumen esas semanas.", pinned: true, dias: 40 },
      { text: "El hombro izquierdo ya no le molesta. Reintroducido press militar al 70%.", pinned: false, dias: 12 },
    ],
    marcos: [
      { text: "Cuatro semanas sin mover el peso CUMPLIENDO. No es adherencia: hay que tocar las kcal o el volumen.", pinned: true, dias: 3 },
      { text: "Rodilla derecha: viene de una condromalacia de 2019. Nada de sentadilla profunda con carga alta.", pinned: true, dias: 60 },
      { text: "Duerme 5-6 h desde que cambió de turno. Probamos magnesio.", pinned: false, dias: 9 },
    ],
    elena: [
      { text: "Tercera semana sin responder al check-in. Llamarla antes de tocar nada del plan.", pinned: true, dias: 2 },
      { text: "Dijo que el plan le parecía mucha comida. Revisar cantidades a la baja.", pinned: false, dias: 25 },
    ],
  };

  let nNotas = 0;
  for (const c of clientes) {
    const notas = NOTAS[c.clave] || [];
    for (let i = 0; i < notas.length; i++) {
      const n = notas[i];
      await TrainerNote.updateOne(
        { _id: oid("note:" + c.clave + ":" + i) },
        { $set: { trainerId, clientId: c._id, text: n.text, pinned: n.pinned, createdAt: hace(n.dias) } },
        { upsert: true }
      );
      nNotas++;
    }
  }

  // Cobros: uno pagado, uno pendiente y uno vencido. Cubre los tres estados.
  let nCobros = 0;
  for (const c of clientes) {
    const cobros = [
      { dias: -25, paid: true, nota: "Mensualidad" },
      { dias: 5, paid: false, nota: "Mensualidad" },
    ];
    if (c.clave === "elena") cobros.push({ dias: 12, paid: false, nota: "Mensualidad (vencida)" });
    for (let i = 0; i < cobros.length; i++) {
      const p = cobros[i];
      await TrainerPayment.updateOne(
        { _id: oid("pay:" + c.clave + ":" + i) },
        {
          $set: {
            trainerId, clientId: c._id, amount: 60, currency: "EUR",
            dueDate: hace(p.dias), paidAt: p.paid ? hace(p.dias) : null, note: p.nota,
          },
        },
        { upsert: true }
      );
      nCobros++;
    }
  }
  console.log("   " + nNotas + " notas y " + nCobros + " cobros");
}

// ---------------------------------------------------------------------------
// EL MÉTODO DEL ENTRENADOR: reglas, protocolo, sus propios pendientes
// ---------------------------------------------------------------------------

/**
 * Historial de cambios con motivo (Fase 4).
 *
 * Es la pestaña que responde "¿por qué está el plan como está?" tres meses
 * después. Se escribe directamente en vez de llamar a
 * planChangeService.record() porque ese crea _id aleatorio y este script
 * necesita ids deterministas para poder deshacerse; la FORMA es la misma que
 * construye record() (plan-change-service.js:54).
 */
async function sembrarHistorial(trainerId, clientes) {
  const PlanChange = require("../components/planChanges/plan-change-schema");

  const POR_CLIENTE = {
    lucia: [
      { dias: 42, entity: "nutritional_goal", action: "updated", entityName: "Definición Lucía",
        reason: "Bajaba 600 g/semana, demasiado rápido. Subo 150 kcal para frenar.",
        changes: [
          { field: "kcalTotal", label: "Calorías", previousValue: 1700, newValue: 1850 },
          { field: "carbohydratesGTotal", label: "Hidratos (g)", previousValue: 157, newValue: 194 },
        ] },
      { dias: 21, entity: "routine", action: "replaced", entityName: "Mesociclo hipertrofia (demo)",
        reason: "Cierra el bloque de adaptación. Entra mesociclo de hipertrofia.",
        changes: [{ field: "name", label: "Rutina", previousValue: "Adaptación 4 semanas", newValue: "Mesociclo hipertrofia (demo)" }] },
      { dias: 7, entity: "checkin_config", action: "updated", entityName: "Check-in semanal",
        reason: "Añado la pregunta de comidas fuera: es donde se le escapa el plan.",
        changes: [{ field: "customQuestions", label: "Preguntas propias", previousValue: 0, newValue: 1 }] },
    ],
    marcos: [
      { dias: 35, entity: "routine", action: "updated", entityName: "Mesociclo hipertrofia (demo)",
        reason: "La rodilla pasa de 5. Sustituyo sentadilla profunda por prensa a rango parcial.",
        changes: [{ field: "exercises", label: "Ejercicios", previousValue: "Sentadilla barra alta", newValue: "Prensa 45°" }] },
      { dias: 14, entity: "protocol", action: "assigned", entityName: "Alta de cliente nuevo (demo)",
        reason: "",
        changes: [{ field: "dailyTasks", label: "Hábitos diarios", previousValue: 0, newValue: 3 }] },
      { dias: 2, entity: "nutritional_goal", action: "updated", entityName: "Mantenimiento Marcos",
        reason: "Cuatro semanas plano CUMPLIENDO. No es adherencia: bajo 200 kcal y subo pasos.",
        changes: [
          { field: "kcalTotal", label: "Calorías", previousValue: 2450, newValue: 2250 },
          { field: "fatGTotal", label: "Grasas (g)", previousValue: 82, newValue: 68 },
        ] },
    ],
    elena: [
      { dias: 60, entity: "diet_plan", action: "assigned", entityName: "Plan de Elena (demo)",
        reason: "Alta. Empezamos con algo sencillo de sostener.",
        changes: [{ field: "kcalTotal", label: "Calorías", previousValue: null, newValue: 1900 }] },
      { dias: 25, entity: "routine", action: "updated", entityName: "Mesociclo hipertrofia (demo)",
        reason: "Bajo de 4 a 3 sesiones: con cuatro no llegaba y acababa no yendo ninguna.",
        changes: [{ field: "sessionsPerWeek", label: "Sesiones por semana", previousValue: 4, newValue: 3 }] },
    ],
  };

  let n = 0;
  for (const c of clientes) {
    const lista = POR_CLIENTE[c.clave] || [];
    for (let i = 0; i < lista.length; i++) {
      const h = lista[i];
      await PlanChange.updateOne(
        { _id: oid("pchg:" + c.clave + ":" + i) },
        {
          $set: {
            trainerId, clientId: c._id,
            entity: h.entity, entityId: null, entityName: h.entityName,
            action: h.action, changes: h.changes, reason: h.reason,
            createdAt: hace(h.dias),
          },
        },
        { upsert: true }
      );
      n++;
    }
  }
  console.log("   " + n + " cambios de plan con motivo");
}

async function sembrarMetodo(trainerId, clientes, grupos) {
  const CoachRule = require("../components/coachRules/coach-rule-schema");
  const CoachProtocol = require("../components/coachProtocols/coach-protocol-schema");
  const CoachTask = require("../components/coachTasks/coach-task-schema");

  const REGLAS = [
    {
      clave: "dolor",
      name: "Dolor por encima del umbral",
      description: "El dolor es lo unico que puede obligarme a cambiar la sesion de hoy.",
      level: "informative",
      trigger: "daily",
      conditions: [{ metric: "pain_max", operator: "gte", value: 5, periodDays: 7 }],
      actions: [{ type: "create_alert", message: "Ha reportado dolor limitante esta semana. Revisa la sesion antes de que entrene.", priority: "high" }],
    },
    {
      clave: "estancamiento",
      name: "Peso plano 3 semanas",
      description: "Si apenas se mueve y esta cumpliendo, el problema es la estrategia.",
      level: "suggestion",
      trigger: "daily",
      conditions: [{ metric: "weight", operator: "changed_less_than_pct", value: 1, periodDays: 21 }],
      actions: [{ type: "create_task", message: "Revisar kcal y volumen: lleva 3 semanas sin mover el peso.", priority: "medium" }],
    },
    {
      clave: "sesiones",
      name: "Menos de 2 sesiones en una semana",
      description: "",
      level: "informative",
      trigger: "daily",
      conditions: [{ metric: "training_sessions", operator: "lt", value: 2, periodDays: 7 }],
      actions: [{ type: "create_alert", message: "Ha entrenado menos de 2 dias esta semana.", priority: "medium" }],
    },
  ];

  for (const r of REGLAS) {
    await CoachRule.updateOne(
      { _id: oid("rule:" + r.clave) },
      {
        $set: {
          trainerId, name: r.name, description: r.description, enabled: true,
          level: r.level, trigger: r.trigger, conditions: r.conditions,
          conditionLogic: "all", actions: r.actions,
          appliesTo: "all_clients", clientIds: [], lastEvaluatedAt: null, disabledReason: null,
        },
      },
      { upsert: true }
    );
  }

  await CoachProtocol.updateOne(
    { _id: oid("protocol:inicio") },
    {
      $set: {
        trainerId,
        name: "Alta de cliente nuevo (demo)",
        description: "Lo que le monto a cualquiera el primer dia: objetivo de mantenimiento, check-in semanal y los tres habitos base.",
        nutritionalGoal: { kcalTotal: 2200, proteinsGTotal: 160, carbohydratesGTotal: 230, fatGTotal: 68 },
        checkinTemplateId: null,
        dietTemplateId: null,
        routineTemplateId: null,
        ruleIds: [oid("rule:dolor"), oid("rule:sesiones")],
        dailyTasks: [
          { type: "steps", label: null, target: 8000, unit: "pasos" },
          { type: "water", label: null, target: 2, unit: "l" },
          { type: "sleep", label: null, target: 7, unit: "h" },
        ],
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );

  const marcos = clientes.find((c) => c.clave === "marcos");
  const elena = clientes.find((c) => c.clave === "elena");
  const PENDIENTES = [
    { clave: "1", title: "Recalcular kcal de Marcos: 4 semanas planas", clientId: marcos._id, dias: 0, done: false },
    { clave: "2", title: "Llamar a Elena antes de tocarle el plan", clientId: elena._id, dias: 1, done: false },
    { clave: "3", title: "Grabar video de tecnica de peso muerto sumo", clientId: null, dias: 3, done: false },
    { clave: "4", title: "Revisar analitica de Lucia", clientId: null, dias: 6, done: true },
  ];
  for (const p of PENDIENTES) {
    await CoachTask.updateOne(
      { _id: oid("ctask:" + p.clave) },
      {
        $set: {
          trainerId, title: p.title, clientId: p.clientId,
          status: p.done ? "done" : "pending",
          dueDate: isoHace(-p.dias),
          createdAt: hace(p.dias + 2),
        },
      },
      { upsert: true }
    );
  }

  console.log("   " + REGLAS.length + " automatizaciones, 1 protocolo, " + PENDIENTES.length + " pendientes del coach");
}



// ---------------------------------------------------------------------------
// BIBLIOTECA DEL ENTRENADOR — recetas, plantillas de entrenamiento, de rutina
// y de dieta, construidas sobre el catálogo REAL de ejercicios.
// ---------------------------------------------------------------------------

/**
 * Los ejercicios NO se inventan: salen del catálogo real (270 ejercicios,
 * 247 globales). Se resuelven por NOMBRE y no por _id a propósito — un id
 * copiado a mano aquí se queda huérfano en silencio si el catálogo se
 * reimporta, mientras que un nombre que ya no existe se puede detectar y
 * decir en voz alta (ver `resolverEjercicios`).
 */
const EJERCICIOS_BIBLIOTECA = [
  // Empuje
  "Press banca", "Press inclinado con mancuernas", "Press militar mancuerna",
  "Press arnold", "Elevaciones laterales sentado", "Fondos en paralelas",
  // Tirón
  "Dominadas agarre neutro", "Jalón agarre cerrado", "Remo pendlay",
  "Remo gironda", "Remo en trx", "Pájaros con mancuernas banco inclinado",
  // Pierna
  "Sentadilla barra alta", "Prensa 45", "Zancadas con barra",
  "Peso muerto rumano", "Curl femoral tumbado", "Hip thrust unilateral",
  "Gemelo en prensa",
  // Brazo y core
  "Curl bíceps barra z", "Press francés mancuernas",
  "Extensión de tríceps overhead con cuerda", "Press pallof", "Rueda abdominal",
];

/**
 * Resuelve los nombres contra el catálogo. Si alguno no existe, lo dice y
 * sigue con los que sí: media biblioteca es mejor que ninguna, pero una
 * biblioteca a la que le faltan ejercicios EN SILENCIO no lo es.
 */
async function resolverEjercicios() {
  const Exercise = require("../components/exercises/exercise-schema");
  const encontrados = new Map();
  const faltan = [];

  for (const nombre of EJERCICIOS_BIBLIOTECA) {
    // Exacto primero; si no, el más corto que empiece igual (el catálogo
    // tiene variantes como "Press banca agarre cerrado").
    let ej = await Exercise.findOne({ name: nombre }).select("name").lean();
    if (!ej) {
      const aprox = await Exercise.find({ name: new RegExp("^" + nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })
        .select("name").limit(10).lean();
      aprox.sort((a, b) => (a.name || "").length - (b.name || "").length);
      ej = aprox[0];
    }
    if (ej) encontrados.set(nombre, ej._id);
    else faltan.push(nombre);
  }

  if (faltan.length) console.log("   (sin coincidencia en el catálogo: " + faltan.join(", ") + ")");
  return encontrados;
}

// --- Recetas -----------------------------------------------------------------

// Ingredientes por nombre de alimento de la despensa, con sus gramos.
const RECETAS = [
  {
    clave: "pollo-arroz",
    name: "Pollo al horno con arroz y brócoli",
    description:
      "Base de volumen: se cocina en una bandeja y aguanta tres días en nevera. "
      + "El brócoli entra los últimos 12 minutos para que no se deshaga.",
    tags: ["Comida", "Batch cooking", "Alto en proteína"],
    ingredientes: [["Pechuga de pollo", 180], ["Arroz basmati", 80], ["Brócoli", 200], ["Aceite de oliva virgen extra", 10]],
  },
  {
    clave: "avena-proteica",
    name: "Avena proteica con plátano",
    description: "Desayuno de dos minutos. Si se deja en nevera toda la noche queda como un pudin.",
    tags: ["Desayuno", "Rápido"],
    ingredientes: [["Avena en copos", 60], ["Claras de huevo", 200], ["Plátano", 120], ["Almendras", 15]],
  },
  {
    clave: "salmon-boniato",
    name: "Salmón con boniato y espinacas",
    description: "Cena de día de entrenamiento. El boniato al microondas 6 minutos y luego a la sartén.",
    tags: ["Cena", "Omega 3"],
    ingredientes: [["Salmón", 150], ["Boniato", 200], ["Espinacas", 150], ["Aceite de oliva virgen extra", 8]],
  },
  {
    clave: "lentejas-verduras",
    name: "Lentejas con verduras",
    description: "Legumbre de toda la vida. Sale barata y da para dos comidas.",
    tags: ["Comida", "Vegetariano", "Fibra"],
    ingredientes: [["Lentejas cocidas", 250], ["Cebolla", 60], ["Pimiento rojo", 80], ["Tomate", 100], ["Aceite de oliva virgen extra", 10]],
  },
  {
    clave: "tortilla-atun",
    name: "Tortilla de atún y calabacín",
    description: "Cena rápida cuando no hay nada preparado. Cinco minutos de sartén.",
    tags: ["Cena", "Rápido", "Alto en proteína"],
    ingredientes: [["Huevo entero", 100], ["Claras de huevo", 150], ["Atún al natural", 80], ["Calabacín", 150]],
  },
  {
    clave: "bowl-quinoa",
    name: "Bowl de quinoa, pavo y aguacate",
    description: "Para llevar en tupper. El aguacate se añade al abrirlo, no antes.",
    tags: ["Comida", "Para llevar"],
    ingredientes: [["Quinoa", 70], ["Pavo", 150], ["Aguacate", 60], ["Tomate", 100], ["Espinacas", 80]],
  },
  {
    clave: "yogur-frutos",
    name: "Yogur griego con arándanos y nueces",
    description: "Merienda o postre. Sube bien la proteína del día sin cocinar nada.",
    tags: ["Merienda", "Sin cocinar"],
    ingredientes: [["Yogur griego natural", 200], ["Arándanos", 80], ["Nueces", 20]],
  },
  {
    clave: "pasta-ternera",
    name: "Pasta integral con ternera y tomate",
    description: "Comida previa a una sesión dura. Se digiere bien con dos o tres horas de margen.",
    tags: ["Comida", "Pre-entreno"],
    ingredientes: [["Pasta integral", 90], ["Ternera magra", 150], ["Tomate", 150], ["Cebolla", 50], ["Aceite de oliva virgen extra", 8]],
  },
];

async function sembrarRecetas(trainerId, alimentos) {
  const Recipe = require("../components/recipes/recipe-schema");
  const CustomProduct = require("../components/customProducts/custom-product-schema");
  const porClave = new Map();
  let nIng = 0;

  for (const r of RECETAS) {
    const ingredienteIds = [];
    for (let i = 0; i < r.ingredientes.length; i++) {
      const [nombre, gramos] = r.ingredientes[i];
      const productId = alimentos.get(nombre);
      if (!productId) throw new Error("La receta '" + r.name + "' pide un alimento que no está en la despensa: " + nombre);

      const id = oid("rcpi:" + r.clave + ":" + i);
      await CustomProduct.updateOne(
        { _id: id },
        { $set: { product: productId, quantity: gramos, order: i, assignedByTrainerId: trainerId } },
        { upsert: true }
      );
      ingredienteIds.push(id);
      nIng++;
    }

    const id = oid("rcp:" + r.clave);
    await Recipe.updateOne(
      { _id: id },
      {
        $set: {
          name: r.name,
          description: r.description,
          tags: r.tags,
          customProducts: ingredienteIds,
          // Del entrenador, no globales: mismo criterio que la despensa.
          userId: trainerId,
          verified: true,
        },
      },
      { upsert: true }
    );
    porClave.set(r.clave, id);
  }

  console.log("   " + RECETAS.length + " recetas con " + nIng + " ingredientes");
  return porClave;
}

// --- Plantillas de entrenamiento (Workout con trainerId) ---------------------

/**
 * Una plantilla de entrenamiento es un Workout con `trainerId` y sin ningún
 * Split que lo referencie (ver workout-template-dao.js, "Unificación
 * workoutTemplates -> workouts"). Los bloques son solo metadata de
 * agrupación; los ejercicios cuelgan del workout con su `blockId`.
 */
const PLANTILLAS_ENTRENO = [
  {
    clave: "torso-empuje",
    name: "Torso · Empuje",
    bloques: [
      { name: "Activación", type: "warmup", ejercicios: [["Press pallof", 2, [10, 12], 60]] },
      { name: "Principal", type: "straight", ejercicios: [
        ["Press banca", 4, [6, 8], 150],
        ["Press militar mancuerna", 3, [8, 10], 120],
      ] },
      { name: "Accesorios", type: "superset", rounds: 3, restBetweenRounds: 90, ejercicios: [
        ["Press inclinado con mancuernas", 3, [10, 12], 60],
        ["Elevaciones laterales sentado", 3, [12, 15], 60],
      ] },
      { name: "Remate", type: "finisher", ejercicios: [["Extensión de tríceps overhead con cuerda", 3, [12, 15], 45]] },
    ],
  },
  {
    clave: "torso-tiron",
    name: "Torso · Tirón",
    bloques: [
      { name: "Principal", type: "straight", ejercicios: [
        ["Dominadas agarre neutro", 4, [6, 10], 150],
        ["Remo pendlay", 4, [8, 10], 120],
      ] },
      { name: "Accesorios", type: "straight", ejercicios: [
        ["Jalón agarre cerrado", 3, [10, 12], 90],
        ["Pájaros con mancuernas banco inclinado", 3, [12, 15], 60],
      ] },
      { name: "Remate", type: "finisher", ejercicios: [["Curl bíceps barra z", 3, [10, 12], 60]] },
    ],
  },
  {
    clave: "pierna-completa",
    name: "Pierna completa",
    bloques: [
      { name: "Principal", type: "straight", ejercicios: [
        ["Sentadilla barra alta", 4, [5, 8], 180],
        ["Peso muerto rumano", 3, [8, 10], 150],
      ] },
      { name: "Accesorios", type: "straight", ejercicios: [
        ["Prensa 45", 3, [10, 12], 120],
        ["Curl femoral tumbado", 3, [12, 15], 60],
        ["Gemelo en prensa", 4, [12, 15], 45],
      ] },
    ],
  },
  {
    clave: "full-body-express",
    name: "Full body express (45 min)",
    bloques: [
      { name: "Circuito", type: "circuit", rounds: 4, restBetweenExercises: 20, restBetweenRounds: 120,
        instructions: "Cuatro vueltas sin parar entre ejercicios. Descanso solo al cerrar la vuelta.",
        ejercicios: [
          ["Sentadilla barra alta", 4, [10, 10], 20],
          ["Press banca", 4, [10, 10], 20],
          ["Remo pendlay", 4, [10, 10], 20],
          ["Rueda abdominal", 4, [8, 10], 120],
        ] },
    ],
  },
];

async function sembrarPlantillasEntreno(trainerId, ejercicios) {
  const Workout = require("../components/workouts/workout-schema");
  const CustomExercise = require("../components/customExercises/custom-exercise-schema");
  const SetModel = require("../components/sets/set-schema");
  const mongoose2 = require("mongoose");

  let nEj = 0, nSets = 0;
  for (const p of PLANTILLAS_ENTRENO) {
    const bloques = [];
    const exIds = [];
    let idxEj = 0;

    for (let b = 0; b < p.bloques.length; b++) {
      const bl = p.bloques[b];
      // El blockId tiene que ser estable entre ejecuciones: si se generara
      // al vuelo, cada resiembra dejaría los ejercicios apuntando a un
      // bloque que ya no existe.
      const blockId = oid("wtb:" + p.clave + ":" + b);
      bloques.push({
        _id: blockId,
        name: bl.name,
        type: bl.type,
        order: b,
        rounds: bl.rounds ?? null,
        restBetweenExercises: bl.restBetweenExercises ?? null,
        restBetweenRounds: bl.restBetweenRounds ?? null,
        instructions: bl.instructions || "",
      });

      for (const [nombreEj, series, reps, descanso] of bl.ejercicios) {
        const exerciseId = ejercicios.get(nombreEj);
        if (!exerciseId) continue;   // ya se avisó al resolver

        const setIds = [];
        for (let k = 0; k < series; k++) {
          const sid = oid("wts:" + p.clave + ":" + idxEj + ":" + k);
          await SetModel.updateOne(
            { _id: sid },
            { $set: { order: k, expectedReps: reps, expectedRir: [2, 1], restSeconds: descanso } },
            { upsert: true }
          );
          setIds.push(sid);
          nSets++;
        }

        const exId = oid("wtx:" + p.clave + ":" + idxEj);
        await CustomExercise.updateOne(
          { _id: exId },
          { $set: { order: idxEj, exercise: exerciseId, sets: setIds, blockId } },
          { upsert: true }
        );
        exIds.push(exId);
        idxEj++;
        nEj++;
      }
    }

    await Workout.updateOne(
      { _id: oid("wt:" + p.clave) },
      { $set: { name: p.name, trainerId, blocks: bloques, exercises: exIds } },
      { upsert: true }
    );
  }

  console.log("   " + PLANTILLAS_ENTRENO.length + " plantillas de entrenamiento ("
    + nEj + " ejercicios, " + nSets + " series)");
}

// --- Plantillas de rutina (Table cuyo userId es el propio entrenador) --------

const PLANTILLAS_RUTINA = [
  {
    clave: "hipertrofia-4d",
    name: "Hipertrofia 4 días · Torso-Pierna",
    microciclos: [
      { nombre: "Semana 1 · Base", purpose: "regular", objective: "Aprender los patrones y dejar RIR 3.", sesiones: ["torso-empuje", "pierna-completa", "torso-tiron"] },
      { nombre: "Semana 2 · Acumulación", purpose: "accumulation", objective: "Una serie más en los principales.", sesiones: ["torso-empuje", "pierna-completa", "torso-tiron"] },
      { nombre: "Semana 3 · Intensificación", purpose: "intensification", objective: "Menos series, más carga. RIR 1 en la última.", sesiones: ["torso-empuje", "pierna-completa", "torso-tiron"] },
      { nombre: "Semana 4 · Descarga", purpose: "deload", objective: "Mitad de volumen. Llegar fresco al siguiente bloque.", sesiones: ["torso-empuje", "pierna-completa"] },
    ],
  },
  {
    clave: "vuelta-3d",
    name: "Vuelta a empezar · 3 días",
    microciclos: [
      { nombre: "Semana 1", purpose: "regular", objective: "Volver sin agujetas que impidan la sesión siguiente.", sesiones: ["full-body-express", "full-body-express", "full-body-express"] },
      { nombre: "Semana 2", purpose: "accumulation", objective: "Subir carga un 5% manteniendo las repeticiones.", sesiones: ["full-body-express", "full-body-express", "full-body-express"] },
    ],
  },
];

async function sembrarPlantillasRutina(trainerId, ejercicios) {
  const Table = require("../components/tables/table-schema");
  const Split = require("../components/splits/split-schema");
  const Workout = require("../components/workouts/workout-schema");
  const CustomExercise = require("../components/customExercises/custom-exercise-schema");
  const SetModel = require("../components/sets/set-schema");

  const porClave = new Map(PLANTILLAS_ENTRENO.map((p) => [p.clave, p]));
  let nSes = 0;

  for (const rt of PLANTILLAS_RUTINA) {
    const splitIds = [];

    for (let m = 0; m < rt.microciclos.length; m++) {
      const mc = rt.microciclos[m];
      const workoutIds = [];

      for (let s = 0; s < mc.sesiones.length; s++) {
        const plantilla = porClave.get(mc.sesiones[s]);
        if (!plantilla) continue;

        // Las sesiones de la rutina son copias propias, no referencias a la
        // plantilla suelta: tocar la rutina de un cliente no puede reescribir
        // la plantilla de la biblioteca.
        const exIds = [];
        let idxEj = 0;
        for (const bl of plantilla.bloques) {
          for (const [nombreEj, series, reps, descanso] of bl.ejercicios) {
            const exerciseId = ejercicios.get(nombreEj);
            if (!exerciseId) continue;

            // En descarga, la mitad de series.
            const nSeries = mc.purpose === "deload" ? Math.max(1, Math.round(series / 2)) : series;
            const setIds = [];
            for (let k = 0; k < nSeries; k++) {
              const sid = oid("rts:" + rt.clave + ":" + m + ":" + s + ":" + idxEj + ":" + k);
              await SetModel.updateOne(
                { _id: sid },
                {
                  $set: {
                    order: k,
                    expectedReps: reps,
                    expectedRir: mc.purpose === "intensification" ? [1, 0] : [2, 1],
                    restSeconds: descanso,
                  },
                },
                { upsert: true }
              );
              setIds.push(sid);
            }

            const exId = oid("rtx:" + rt.clave + ":" + m + ":" + s + ":" + idxEj);
            await CustomExercise.updateOne(
              { _id: exId },
              { $set: { order: idxEj, exercise: exerciseId, sets: setIds } },
              { upsert: true }
            );
            exIds.push(exId);
            idxEj++;
          }
        }

        const wId = oid("rtw:" + rt.clave + ":" + m + ":" + s);
        await Workout.updateOne(
          { _id: wId },
          { $set: { name: plantilla.name, exercises: exIds } },
          { upsert: true }
        );
        workoutIds.push(wId);
        nSes++;
      }

      const spId = oid("rtsp:" + rt.clave + ":" + m);
      await Split.updateOne(
        { _id: spId },
        { $set: { name: mc.nombre, objective: mc.objective, purpose: mc.purpose, workouts: workoutIds } },
        { upsert: true }
      );
      splitIds.push(spId);
    }

    await Table.updateOne(
      { _id: oid("rt:" + rt.clave) },
      // userId = el propio entrenador: así es como table-dao.js
      // #createTableForTrainer marca una rutina de biblioteca.
      { $set: { name: rt.name, userId: trainerId, assignedByTrainerId: trainerId, splits: splitIds } },
      { upsert: true }
    );
  }

  console.log("   " + PLANTILLAS_RUTINA.length + " plantillas de rutina (" + nSes + " sesiones)");
}

// --- Plantilla de dieta ------------------------------------------------------

/**
 * Los slots tienen que coincidir con diet-days-util.js#MEALS para poder
 * resolverse contra el DietDay real del cliente.
 *
 * Se siembran las tres modalidades que admite el modelo:
 *   - `sequential`: días numerados que se aplican en orden.
 *   - `choice`: una comida con VARIAS alternativas, y el cliente elige.
 * Con una sola alternativa por comida el comportamiento es el de siempre.
 */
const PLANTILLAS_DIETA = [
  {
    clave: "2200-4comidas",
    name: "1.900 kcal · 4 comidas",
    mode: "sequential",
    dias: [
      {
        dayLabel: "Día 1",
        comidas: [
          { slot: "Desayuno", alternativas: [{ label: "", recetas: ["avena-proteica"] }] },
          { slot: "Comida", alternativas: [{ label: "", recetas: ["pollo-arroz"] }] },
          { slot: "Merienda", alternativas: [{ label: "", recetas: ["yogur-frutos"] }] },
          { slot: "Cena", alternativas: [{ label: "", recetas: ["tortilla-atun"] }] },
        ],
      },
      {
        dayLabel: "Día 2",
        comidas: [
          { slot: "Desayuno", alternativas: [{ label: "", productos: [["Pan integral", 110], ["Huevo entero", 150], ["Aguacate", 60]] }] },
          { slot: "Comida", alternativas: [{ label: "", recetas: ["lentejas-verduras"] }] },
          { slot: "Merienda", alternativas: [{ label: "", productos: [["Manzana", 150], ["Almendras", 35]] }] },
          { slot: "Cena", alternativas: [{ label: "", recetas: ["salmon-boniato"] }] },
        ],
      },
      {
        dayLabel: "Día 3",
        comidas: [
          { slot: "Desayuno", alternativas: [{ label: "", recetas: ["avena-proteica"] }] },
          { slot: "Comida", alternativas: [{ label: "", recetas: ["pasta-ternera"] }] },
          { slot: "Merienda", alternativas: [{ label: "", productos: [["Queso fresco batido 0%", 200], ["Arándanos", 80]] }] },
          { slot: "Cena", alternativas: [{ label: "", recetas: ["bowl-quinoa"] }] },
        ],
      },
    ],
  },
  {
    clave: "elige-comida",
    name: "Comida a elegir · plantilla flexible",
    mode: "sequential",
    dias: [
      {
        dayLabel: "Cualquier día",
        comidas: [
          { slot: "Desayuno", alternativas: [
            { label: "Dulce", recetas: ["avena-proteica"] },
            { label: "Salado", productos: [["Pan integral", 80], ["Huevo entero", 150], ["Tomate", 100]] },
          ] },
          // Tres alternativas: el cliente recibe una propuesta y elige.
          { slot: "Comida", alternativas: [
            { label: "Pollo", recetas: ["pollo-arroz"] },
            { label: "Legumbre", recetas: ["lentejas-verduras"] },
            { label: "Pasta", recetas: ["pasta-ternera"] },
          ] },
          { slot: "Cena", alternativas: [
            { label: "Pescado", recetas: ["salmon-boniato"] },
            { label: "Huevo", recetas: ["tortilla-atun"] },
          ] },
        ],
      },
    ],
  },
];

async function sembrarPlantillasDieta(trainerId, alimentos, recetas) {
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const CustomProduct = require("../components/customProducts/custom-product-schema");
  const CustomRecipe = require("../components/customRecipes/custom-recipe-schema");

  let nAlt = 0;
  for (const t of PLANTILLAS_DIETA) {
    const dias = [];

    for (let d = 0; d < t.dias.length; d++) {
      const dia = t.dias[d];
      const comidas = [];

      for (let c = 0; c < dia.comidas.length; c++) {
        const comida = dia.comidas[c];
        const alternativas = [];

        for (let a = 0; a < comida.alternativas.length; a++) {
          const alt = comida.alternativas[a];
          const base = t.clave + ":" + d + ":" + c + ":" + a;
          const cpIds = [];
          const crIds = [];

          for (let i = 0; i < (alt.productos || []).length; i++) {
            const [nombre, gramos] = alt.productos[i];
            const productId = alimentos.get(nombre);
            if (!productId) throw new Error("Plantilla de dieta pide un alimento que no existe: " + nombre);
            const id = oid("dtp:" + base + ":" + i);
            await CustomProduct.updateOne(
              { _id: id },
              { $set: { product: productId, quantity: gramos, order: i, assignedByTrainerId: trainerId } },
              { upsert: true }
            );
            cpIds.push(id);
          }

          for (let i = 0; i < (alt.recetas || []).length; i++) {
            const recipeId = recetas.get(alt.recetas[i]);
            if (!recipeId) throw new Error("Plantilla de dieta pide una receta que no existe: " + alt.recetas[i]);
            const id = oid("dtr:" + base + ":" + i);
            // OJO: `quantity` NO es opcional aunque el esquema lo permita.
            // La ración pautada se calcula como quantity / peso total de la
            // receta (diet-days-nutrition-util.js#macrosForCustomRecipe), y
            // con quantity null ese cociente es 0: la receta aparecería en
            // el plan aportando CERO kcal, sin ningún error visible. Se
            // pauta la receta entera = la suma de sus ingredientes.
            const receta = RECETAS.find((x) => x.clave === alt.recetas[i]);
            const gramosTotales = receta.ingredientes.reduce((a, [, g]) => a + g, 0);
            await CustomRecipe.updateOne(
              { _id: id },
              { $set: { recipe: recipeId, quantity: gramosTotales, assignedByTrainerId: trainerId } },
              { upsert: true }
            );
            crIds.push(id);
          }

          alternativas.push({ label: alt.label || "", customProducts: cpIds, customRecipes: crIds });
          nAlt++;
        }

        comidas.push({ slot: comida.slot, alternatives: alternativas });
      }

      dias.push({ dayLabel: dia.dayLabel, meals: comidas });
    }

    await DietTemplate.updateOne(
      { _id: oid("dt:" + t.clave) },
      { $set: { trainerId, name: t.name, mode: t.mode, days: dias, dayPatterns: [] } },
      { upsert: true }
    );
  }

  console.log("   " + PLANTILLAS_DIETA.length + " plantillas de dieta (" + nAlt + " alternativas de comida)");
}

// --- Orquestador de la biblioteca -------------------------------------------

async function sembrarBiblioteca(trainerId, alimentos) {
  const ejercicios = await resolverEjercicios();
  console.log("   " + ejercicios.size + " ejercicios resueltos del catálogo real");

  const recetas = await sembrarRecetas(trainerId, alimentos);
  await sembrarPlantillasEntreno(trainerId, ejercicios);
  await sembrarPlantillasRutina(trainerId, ejercicios);
  await sembrarPlantillasDieta(trainerId, alimentos, recetas);
  return recetas;
}

// ---------------------------------------------------------------------------
// BORRADO
// ---------------------------------------------------------------------------

/**
 * Borra EXACTAMENTE lo que este script inserta. Nada más.
 *
 * No hace deleteMany sobre colecciones enteras ni borra "todo lo del
 * entrenador X": recorre los mismos _id deterministas que usó al sembrar y
 * los quita uno a uno. Si mañana alguien crea un suplemento de verdad, este
 * script no puede tocarlo aunque se ejecute por error.
 */
async function limpiar() {
  const M = {
    User: require("../components/users/schema"),
    TrainerClient: require("../components/trainerClients/trainer-client-schema"),
    Anthropometry: mongoose.models.Anthropometry
      || mongoose.model("Anthropometry", require("../components/anthropometry/anthropometry-schema")),
    CheckinSchedule: require("../components/trainerCheckins/checkin-schedule-schema"),
    CheckinResponse: require("../components/trainerCheckins/checkin-response-schema"),
    CheckinRequest: require("../components/trainerCheckins/checkin-request-schema"),
    WeightPlan: require("../components/weightPlans/weight-plan-schema"),
    PainEntry: require("../components/painLog/pain-schema").PainEntry,
    PainThreshold: require("../components/painLog/pain-schema").PainThreshold,
    ExerciseScore: require("../components/exerciseScores/exercise-score-schema"),
    Table: require("../components/tables/table-schema"),
    Split: require("../components/splits/split-schema"),
    Workout: require("../components/workouts/workout-schema"),
    CustomExercise: require("../components/customExercises/custom-exercise-schema"),
    Set: require("../components/sets/set-schema"),
    FoodExchangeGroup: require("../components/foodExchanges/food-exchange-schema"),
    Product: require("../components/products/product-schema"),
    Recipe: require("../components/recipes/recipe-schema"),
    CustomRecipe: require("../components/customRecipes/custom-recipe-schema"),
    DietTemplate: require("../components/dietTemplates/diet-template-schema"),
    NutritionalGoal: require("../components/nutritionalGoals/nutritional-goal-schema"),
    Diet: require("../components/diets/diet-schema"),
    DietDay: require("../components/dietDays/diet-days-schema"),
    Meal: require("../components/meals/meal-schema"),
    CustomProduct: require("../components/customProducts/custom-product-schema"),
    Supplement: require("../components/supplements/supplement-schema").Supplement,
    TrainerTask: require("../components/trainerTasks/trainer-task-schema"),
    TaskCompletion: require("../components/trainerTasks/task-completion-schema"),
    TrainerNote: require("../components/trainerNotes/trainer-note-schema"),
    TrainerPayment: require("../components/trainerPayments/trainer-payment-schema"),
    CoachRule: require("../components/coachRules/coach-rule-schema"),
    CoachProtocol: require("../components/coachProtocols/coach-protocol-schema"),
    CoachTask: require("../components/coachTasks/coach-task-schema"),
    PlanChange: require("../components/planChanges/plan-change-schema"),
    CoachAlert: require("../components/coachAlerts/coach-alert-schema"),
  };

  // Se reconstruyen todas las semillas usadas al sembrar.
  const ids = { };
  const push = (modelo, semilla) => {
    ids[modelo] = ids[modelo] || [];
    ids[modelo].push(oid(semilla));
  };

  for (const c of CLIENTES) {
    const k = c.clave;
    push("User", "user:" + k);
    for (const scope of ["training", "nutrition"]) push("TrainerClient", "rel:" + k + ":" + scope);
    for (let s = 0; s < 12; s++) push("Anthropometry", "antro:" + k + ":" + s);
    push("CheckinSchedule", "chkcfg:" + k);
    push("WeightPlan", "peso:" + k);
    push("CheckinRequest", "chk:" + k + ":abierta");
    for (let i = 0; i < 8; i++) {
      push("CheckinResponse", "chk:" + k + ":" + i);
      push("CheckinRequest", "chk:" + k + ":" + i);
    }
    push("NutritionalGoal", "goal:" + k);
    push("Diet", "diet:" + k);
    push("Table", "table:" + k);

    for (let m = 0; m < 4; m++) {
      push("Split", "split:" + k + ":" + m);
      for (let s = 0; s < 3; s++) {
        push("Workout", "w:" + k + ":" + m + ":" + s);
        for (let e = 0; e < 5; e++) {
          push("CustomExercise", "cex:" + k + ":" + m + ":" + s + ":" + e);
          for (let x = 0; x < 4; x++) push("Set", "set:" + k + ":" + m + ":" + s + ":" + e + ":" + x);
        }
      }
    }

    for (let d = 13; d >= -7; d--) {
      push("DietDay", "dd:" + k + ":" + d);
      for (let mi = 0; mi < 4; mi++) {
        push("Meal", "meal:" + k + ":" + d + ":" + mi);
        for (let ii = 0; ii < 4; ii++) push("CustomProduct", "cp:" + k + ":" + d + ":" + mi + ":" + ii);
      }
    }

    for (let i = 0; i < 3; i++) {
      push("TrainerTask", "task:" + k + ":" + i);
      for (let d = 0; d < 28; d++) push("TaskCompletion", "taskc:" + k + ":" + i + ":" + d);
      push("Supplement", "supp:" + k + ":" + i);
    }
    for (let i = 0; i < 3; i++) push("TrainerNote", "note:" + k + ":" + i);
    for (let i = 0; i < 3; i++) push("TrainerPayment", "pay:" + k + ":" + i);
    for (let i = 0; i < 3; i++) push("PlanChange", "pchg:" + k + ":" + i);
  }

  for (let i = 0; i < 10; i++) push("PainEntry", "pain:marcos:rodilla:" + i);
  for (let i = 0; i < 3; i++) push("PainEntry", "pain:marcos:lumbar:" + i);
  for (let i = 0; i < 4; i++) push("PainEntry", "pain:lucia:hombro:" + i);
  push("PainThreshold", "painthr:marcos:rodilla");
  push("PainThreshold", "painthr:lucia:hombro");

  for (const g of ["proteina", "hidratos", "grasa", "verduras"]) push("FoodExchangeGroup", "exgrp:" + g);
  for (const [nombre] of ALIMENTOS) push("Product", "prod:" + nombre);

  // --- Biblioteca ---
  for (const r of RECETAS) {
    push("Recipe", "rcp:" + r.clave);
    for (let i = 0; i < r.ingredientes.length; i++) push("CustomProduct", "rcpi:" + r.clave + ":" + i);
  }

  for (const p of PLANTILLAS_ENTRENO) {
    push("Workout", "wt:" + p.clave);
    // Los ejercicios van numerados de corrido sobre TODOS los bloques, así
    // que se recorre el mismo total que al sembrar en vez de un tope fijo.
    let idx = 0;
    for (const bl of p.bloques) {
      for (const [, series] of bl.ejercicios) {
        push("CustomExercise", "wtx:" + p.clave + ":" + idx);
        for (let k = 0; k < series; k++) push("Set", "wts:" + p.clave + ":" + idx + ":" + k);
        idx++;
      }
    }
  }

  const entrenoPorClave = new Map(PLANTILLAS_ENTRENO.map((p) => [p.clave, p]));
  for (const rt of PLANTILLAS_RUTINA) {
    push("Table", "rt:" + rt.clave);
    for (let m = 0; m < rt.microciclos.length; m++) {
      push("Split", "rtsp:" + rt.clave + ":" + m);
      const mc = rt.microciclos[m];
      for (let s = 0; s < mc.sesiones.length; s++) {
        push("Workout", "rtw:" + rt.clave + ":" + m + ":" + s);
        const plantilla = entrenoPorClave.get(mc.sesiones[s]);
        if (!plantilla) continue;
        let idx = 0;
        for (const bl of plantilla.bloques) {
          for (const [, series] of bl.ejercicios) {
            push("CustomExercise", "rtx:" + rt.clave + ":" + m + ":" + s + ":" + idx);
            for (let k = 0; k < series; k++) {
              push("Set", "rts:" + rt.clave + ":" + m + ":" + s + ":" + idx + ":" + k);
            }
            idx++;
          }
        }
      }
    }
  }

  for (const t of PLANTILLAS_DIETA) {
    push("DietTemplate", "dt:" + t.clave);
    for (let d = 0; d < t.dias.length; d++) {
      for (let c = 0; c < t.dias[d].comidas.length; c++) {
        const alts = t.dias[d].comidas[c].alternativas;
        for (let a = 0; a < alts.length; a++) {
          const base = t.clave + ":" + d + ":" + c + ":" + a;
          for (let i = 0; i < (alts[a].productos || []).length; i++) push("CustomProduct", "dtp:" + base + ":" + i);
          for (let i = 0; i < (alts[a].recetas || []).length; i++) push("CustomRecipe", "dtr:" + base + ":" + i);
        }
      }
    }
  }
  for (const e of EJERCICIOS_DEMO) push("ExerciseScore", "score:" + e.id);
  for (const r of ["dolor", "estancamiento", "sesiones"]) push("CoachRule", "rule:" + r);
  push("CoachProtocol", "protocol:inicio");
  for (const t of ["1", "2", "3", "4"]) push("CoachTask", "ctask:" + t);

  // OJO al leer el recuento: Split, Workout, CustomExercise, Set, DietDay,
  // Meal, CustomProduct y TaskCompletion saldrán casi siempre a 0. No es que
  // no se borren — es que ya los ha borrado la CASCADA de su padre:
  // Table.pre("deleteMany") arrastra los splits (table-schema.js:55),
  // Diet.pre("deleteMany") los días (diet-schema.js:38) y
  // TrainerTask.pre("deleteMany") las marcas (trainer-task-schema.js:55).
  // Se siguen recorriendo a propósito: si una cascada fallara o quedaran
  // huérfanos de una ejecución anterior, esta pasada los recoge.
  let total = 0;
  for (const [nombre, lista] of Object.entries(ids)) {
    const r = await M[nombre].deleteMany({ _id: { $in: lista } });
    if (r.deletedCount) console.log("   " + nombre.padEnd(24) + r.deletedCount);
    total += r.deletedCount;
  }

  // Las alertas las genera el evaluador nocturno a partir de los clientes de
  // demo, así que no tienen _id determinista: se borran por clientId.
  const clientIds = CLIENTES.map(idCliente);
  const alertas = await M.CoachAlert.deleteMany({ clientId: { $in: clientIds } });
  if (alertas.deletedCount) console.log("   " + "CoachAlert".padEnd(24) + alertas.deletedCount);
  total += alertas.deletedCount;

  console.log("\n" + total + " documentos de demo eliminados.");
}

// ---------------------------------------------------------------------------
// ARRANQUE
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const limpiando = args.includes("--clean");
  const argTrainer = args.find((a) => a.startsWith("--trainer="));
  const trainerId = new mongoose.Types.ObjectId(
    argTrainer ? argTrainer.split("=")[1] : TRAINER_POR_DEFECTO
  );

  const uri = buildMongoUri();
  console.log("conectando a " + redactMongoUri(uri) + "\n");
  await mongoose.connect(uri);

  if (limpiando) {
    console.log("BORRANDO datos de demo...\n");
    await limpiar();
    await mongoose.disconnect();
    return;
  }

  const User = require("../components/users/schema");
  const trainer = await User.findById(trainerId).select("name lastname email roles").lean();
  if (!trainer) {
    console.error("No existe ningún usuario con id " + trainerId + ". Usa --trainer=<id>.");
    process.exit(1);
  }
  if (!(trainer.roles || []).includes("trainer")) {
    console.error(trainer.email + " no tiene rol de entrenador. Usa --trainer=<id>.");
    process.exit(1);
  }

  console.log("Entrenador: " + (trainer.name || "") + " " + (trainer.lastname || "") + " <" + trainer.email + ">");
  console.log("Sembrando...\n");

  const clientes = await sembrarClientes(trainerId);
  for (const c of clientes) c.trainerId = trainerId;

  await sembrarAntropometria(clientes);
  await sembrarCheckins(trainerId, clientes);
  await sembrarDolor(clientes);
  await sembrarPuntuaciones(trainerId);
  await sembrarRutinas(trainerId, clientes);
  const grupos = await sembrarIntercambios(trainerId);
  await sembrarObjetivos(trainerId, clientes, grupos);
  const alimentos = await sembrarAlimentos(trainerId);
  await sembrarDietas(trainerId, clientes, alimentos);
  await sembrarSuplementos(trainerId, clientes);
  await sembrarHabitos(trainerId, clientes);
  await sembrarNotasYCobros(trainerId, clientes);
  await sembrarHistorial(trainerId, clientes);
  await sembrarBiblioteca(trainerId, alimentos);
  await sembrarMetodo(trainerId, clientes, grupos);

  // Las alertas NO se insertan a mano: se dispara el mismo evaluador que
  // corre cada noche. Así lo que ves en el panel es lo que el motor genera
  // de verdad con estos datos, no un decorado.
  console.log("\nEvaluando alertas con el motor real...");
  const { evaluateTrainer } = require("../components/coachAlerts/coach-alert-service");
  const resultado = await evaluateTrainer(trainerId);
  console.log("   " + JSON.stringify(resultado));

  console.log("\nLISTO.");
  console.log("\nEntra como entrenador con tu cuenta (" + trainer.email + ").");
  console.log("Para ver el lado del CLIENTE, inicia sesión con cualquiera de estos:");
  for (const c of CLIENTES) console.log("   " + emailDe(c) + "   /   " + PASSWORD_DEMO);
  console.log("\nPara borrarlo todo:  node scripts/seed-demo-coach-pro.js --clean");

  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("\nFALLO:", error.message);
  console.error(error.stack);
  process.exit(1);
});
