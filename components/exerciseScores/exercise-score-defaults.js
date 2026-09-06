// 2026-09 — puntuación IEM/IEA por defecto, para que un ejercicio no
// arranque "sin puntuar" cuando el entrenador todavía no lo ha tocado. Sigue
// siendo 100% editable: esto es solo el valor inicial del formulario, guardar
// crea el override real de SIEMPRE (ver exercise-score-controller.js#upsert).
//
// POR QUÉ NO SALE DE Exercise.muscleGroups1/2
// Se probó primero derivarlo del propio catálogo de ejercicios
// (muscleGroups1/2), pero ese campo usa un vocabulario de solo 5 categorías
// anchas (Pecho/Espalda/Pierna/Core/Hombros — ver
// packages/shared-ui/src/app/shared/constants/muscle-groups.ts) mientras que
// la puntuación usa 16 músculos finos + 8 articulaciones. No hay mapeo fiable
// entre los dos ("Pierna" no dice si castiga Cuádriceps, Femoral, Glúteo o
// Aductor; ni siquiera existe categoría para Bíceps/Tríceps). Inventar ese
// mapeo sería fabricar un dato, justo lo que exercise-score-catalog.js dice
// explícitamente que esta puntuación NO debe ser ("un criterio oficial que
// nadie le ha pedido a la aplicación").
//
// EN VEZ DE ESO: una biblioteca curada por PATRÓN DE MOVIMIENTO, emparejada
// por palabras clave contra el NOMBRE real del ejercicio (auditado contra los
// 242 nombres reales del catálogo, ver
// scripts/exercise-description-backup-*.json). Un patrón por familia de
// movimiento, no 242 entradas sueltas — así un ejercicio nuevo del catálogo
// que encaje en un patrón ya conocido también sale puntuado sin tocar este
// archivo.
//
// Sigue siendo una SUGERENCIA de partida, con criterio biomecánico estándar,
// no LA puntuación de nadie en particular — de ahí que el entrenador pueda
// (y deba, si su escuela piensa distinto) cambiar cualquier valor.

function m(entries) {
  return entries.map(([name, score]) => ({ name, score }));
}

// --- Perfiles reutilizables ---

const PROFILES = {
  // --- Empuje horizontal (press banca y variantes) ---
  chestPress: {
    muscleScores: m([["Pectoral", 3], ["Tríceps", 1], ["Deltoides anterior", 1]]),
    jointScores: m([["Hombro", 1], ["Codo", 1]]),
  },
  chestFly: {
    muscleScores: m([["Pectoral", 3], ["Deltoides anterior", 1]]),
    jointScores: m([["Hombro", 1]]),
  },
  dips: {
    muscleScores: m([["Tríceps", 2], ["Pectoral", 2], ["Deltoides anterior", 1]]),
    jointScores: m([["Hombro", 1], ["Codo", 1]]),
  },
  pushup: {
    muscleScores: m([["Pectoral", 2], ["Tríceps", 1], ["Abdomen", 1], ["Deltoides anterior", 1]]),
    jointScores: m([["Hombro", 1], ["Codo", 1]]),
  },

  // --- Empuje vertical (militar y overhead) ---
  overheadPress: {
    muscleScores: m([["Deltoides anterior", 3], ["Tríceps", 1], ["Deltoides lateral", 1]]),
    jointScores: m([["Hombro", 2]]),
  },
  lateralRaise: {
    muscleScores: m([["Deltoides lateral", 3]]),
    jointScores: m([["Hombro", 1]]),
  },
  frontRaise: {
    muscleScores: m([["Deltoides anterior", 3]]),
    jointScores: m([["Hombro", 1]]),
  },
  rearDelt: {
    muscleScores: m([["Deltoides posterior", 3], ["Espalda alta", 1]]),
    jointScores: m([["Hombro", 1]]),
  },

  // --- Tríceps aislado ---
  tricepsExt: {
    muscleScores: m([["Tríceps", 3]]),
    jointScores: m([["Codo", 2]]),
  },

  // --- Bíceps aislado ---
  bicepsCurl: {
    muscleScores: m([["Bíceps", 3], ["Antebrazo", 1]]),
    jointScores: m([["Codo", 1]]),
  },
  forearmCurl: {
    muscleScores: m([["Antebrazo", 3]]),
    jointScores: m([["Muñeca", 1]]),
  },

  // --- Tirón horizontal/vertical (espalda) ---
  row: {
    muscleScores: m([["Espalda alta", 3], ["Bíceps", 1], ["Deltoides posterior", 1]]),
    jointScores: m([["Columna lumbar", 1], ["Hombro", 1]]),
  },
  pulldown: {
    muscleScores: m([["Espalda alta", 3], ["Bíceps", 2]]),
    jointScores: m([["Hombro", 1], ["Codo", 1]]),
  },
  pullup: {
    muscleScores: m([["Espalda alta", 3], ["Bíceps", 2], ["Antebrazo", 1]]),
    jointScores: m([["Hombro", 1], ["Codo", 1]]),
  },
  pullover: {
    muscleScores: m([["Espalda alta", 2], ["Pectoral", 1], ["Tríceps", 1]]),
    jointScores: m([["Hombro", 1]]),
  },

  // --- Sentadilla / prensa (cuádriceps-dominante) ---
  squat: {
    muscleScores: m([["Cuádriceps", 3], ["Glúteo", 2], ["Femoral", 1]]),
    jointScores: m([["Rodilla", 2], ["Cadera", 1], ["Columna lumbar", 1]]),
  },
  legPress: {
    muscleScores: m([["Cuádriceps", 3], ["Glúteo", 1]]),
    jointScores: m([["Rodilla", 1]]),
  },
  legExtension: {
    muscleScores: m([["Cuádriceps", 3]]),
    jointScores: m([["Rodilla", 2]]),
  },
  lunge: {
    muscleScores: m([["Cuádriceps", 2], ["Glúteo", 2], ["Femoral", 1]]),
    jointScores: m([["Rodilla", 1], ["Cadera", 1]]),
  },

  // --- Bisagra de cadera (isquio/glúteo-dominante) ---
  deadlift: {
    muscleScores: m([["Femoral", 3], ["Glúteo", 3], ["Espalda baja", 2]]),
    jointScores: m([["Columna lumbar", 2], ["Cadera", 1]]),
  },
  hipThrust: {
    muscleScores: m([["Glúteo", 3], ["Femoral", 1]]),
    jointScores: m([["Cadera", 1]]),
  },
  goodMorning: {
    muscleScores: m([["Femoral", 2], ["Glúteo", 2], ["Espalda baja", 2]]),
    jointScores: m([["Columna lumbar", 2], ["Cadera", 1]]),
  },
  legCurl: {
    muscleScores: m([["Femoral", 3]]),
    jointScores: m([["Rodilla", 1]]),
  },
  gluteMedius: {
    muscleScores: m([["Glúteo", 2]]),
    jointScores: m([["Cadera", 1]]),
  },
  lowerBackExt: {
    muscleScores: m([["Espalda baja", 3]]),
    jointScores: m([["Columna lumbar", 2]]),
  },

  // --- Pierna: aductor/abductor/gemelo ---
  adductor: {
    muscleScores: m([["Aductor", 3]]),
    jointScores: m([["Cadera", 1]]),
  },
  abductor: {
    muscleScores: m([["Glúteo", 2]]),
    jointScores: m([["Cadera", 1]]),
  },
  calfRaise: {
    muscleScores: m([["Gemelo", 3]]),
    jointScores: m([["Tobillo", 1]]),
  },

  // --- Core / abdomen ---
  absCrunch: {
    muscleScores: m([["Abdomen", 3]]),
    jointScores: m([]),
  },
  obliques: {
    muscleScores: m([["Oblicuos", 3]]),
    jointScores: m([]),
  },
  plank: {
    muscleScores: m([["Abdomen", 2]]),
    jointScores: m([["Columna lumbar", 1]]),
  },
  antiRotationCore: {
    muscleScores: m([["Abdomen", 2], ["Oblicuos", 2]]),
    jointScores: m([["Columna lumbar", 1]]),
  },

  // --- Grip / carries ---
  grip: {
    muscleScores: m([["Antebrazo", 3]]),
    jointScores: m([["Hombro", 1], ["Muñeca", 1]]),
  },

  // --- Cardio / acondicionamiento — carga muscular ligera y genérica, sin
  // pretender precisión: el marco IEM/IEA está pensado para trabajo de
  // fuerza por series, no para intervalos ni carrera continua. */null =
  // deliberadamente sin sugerencia, mejor nada que un número inventado.
  lowerBodyConditioning: {
    muscleScores: m([["Cuádriceps", 1], ["Gemelo", 1]]),
    jointScores: m([["Rodilla", 1], ["Tobillo", 1]]),
  },
};

// --- Reglas: primero la más específica que encaje, en orden. ---
// Cada `test` recibe el nombre YA en minúsculas, sin acentos alterados
// (los nombres reales del catálogo llevan tilde y se comparan tal cual).
const RULES = [
  // Compuestos que si no se sacan antes caerían en un cubo genérico peor.
  { test: (n) => n.includes("curl nordico"), profile: { muscleScores: m([["Femoral", 3]]), jointScores: m([["Rodilla", 1]]) } },
  { test: (n) => n.includes("curl femoral"), profile: PROFILES.legCurl },
  { test: (n) => n.includes("curl prono") || n.includes("curl supino") && n.includes("antebrazo"), profile: PROFILES.forearmCurl },
  { test: (n) => n.includes("antebrazo"), profile: PROFILES.forearmCurl },
  // "patada de g" (no "gl"): el catálogo real tiene una fila con typo
  // ("Patada de gúteo bilateral en multipower", sin la ele de glúteo) — las
  // de tríceps empiezan por "patada de t", así que el prefijo no choca.
  { test: (n) => n.includes("hip thrust") || n.includes("puente de gl") || n.includes("patada de g"), profile: PROFILES.hipThrust },
  { test: (n) => n.includes("glúteo medio") || n.includes("gluteo medio"), profile: PROFILES.gluteMedius },
  { test: (n) => n.includes("buenos días") || n.includes("buenos dias"), profile: PROFILES.goodMorning },
  { test: (n) => n.includes("pull through"), profile: PROFILES.goodMorning },
  { test: (n) => n.includes("peso muerto") || n.includes("rack pull"), profile: PROFILES.deadlift },
  { test: (n) => n.includes("reverse hyper") || n.includes("hiperextensión") || n.includes("hiperextension"), profile: PROFILES.lowerBackExt },
  { test: (n) => n.includes("extensión lumbar") || n.includes("extension lumbar"), profile: PROFILES.lowerBackExt },

  // "sentadillla" (triple ele): typo real del catálogo
  // ("Sentadillla bulgara multipower") — se acepta tal cual.
  { test: (n) => n.includes("sentadilla") || n.includes("sentadillla") || n.includes("squat") || n.includes("zancada") || n.includes("step up"), profile: (n) =>
      n.includes("búlgara") || n.includes("bulgara") || n.includes("zancada") || n.includes("step up")
        ? PROFILES.lunge
        : PROFILES.squat,
  },
  { test: (n) => n.includes("prensa"), profile: PROFILES.legPress },
  { test: (n) => n.includes("extensión de cuádriceps") || n.includes("extension de cuadriceps"), profile: PROFILES.legExtension },

  { test: (n) => n.includes("aductor"), profile: PROFILES.adductor },
  { test: (n) => n.includes("abductor"), profile: PROFILES.abductor },
  { test: (n) => n.includes("gemelo") || n.includes("soleo"), profile: PROFILES.calfRaise },

  { test: (n) => n.includes("dominadas") || n.includes("máquina de dominadas") || n.includes("maquina de dominadas"), profile: PROFILES.pullup },
  { test: (n) => n.includes("pull over") || n.includes("pullover"), profile: PROFILES.pullover },
  { test: (n) => n.includes("jalón") || n.includes("jalon") || n.includes("pull down"), profile: PROFILES.pulldown },
  { test: (n) => n.includes("facepull") || n.includes("face pull") || n.includes("cruce posterior") || n.includes("hombro posterior") || n.includes("pájaro") || n.includes("pajaro"), profile: PROFILES.rearDelt },
  // "row" en inglés: el catálogo tiene un puñado de filas sin traducir
  // ("Seal row", "Bend over row").
  { test: (n) => n.includes("remo") || n.includes(" row") || n.startsWith("row"), profile: PROFILES.row },

  { test: (n) => n.includes("fondos") || n.includes("dips"), profile: PROFILES.dips },
  { test: (n) => n.includes("flexiones") || n.includes("push up") || n.includes("pushup"), profile: PROFILES.pushup },
  { test: (n) => n.includes("aperturas") || n.includes("cruce poleas") || n.includes("contractora"), profile: PROFILES.chestFly },
  { test: (n) => n.includes("press") && (n.includes("banca") || n.includes("plano") || n.includes("inclinado") || n.includes("declinado") || n.includes("tumbado") || n.includes("svend") || n.includes("spoto")), profile: PROFILES.chestPress },

  { test: (n) => n.includes("elevaciones frontales"), profile: PROFILES.frontRaise },
  { test: (n) => n.includes("elevac") && n.includes("lateral"), profile: PROFILES.lateralRaise },
  { test: (n) => n.includes("press") && (n.includes("militar") || n.includes("arnold") || n.includes("push press") || n.includes("landmine") || n.includes("pin press") || n.includes("larsen")), profile: PROFILES.overheadPress },
  { test: (n) => n.includes("francés") || n.includes("frances") || n.includes("kaz press") || n.includes("dead french"), profile: PROFILES.tricepsExt },
  { test: (n) => n.includes("extensión de tríceps") || n.includes("extension de triceps") || n.includes("patada de tríceps") || n.includes("patada de triceps") || n.includes("overhead"), profile: PROFILES.tricepsExt },

  { test: (n) => n.includes("curl") && (n.includes("bíceps") || n.includes("biceps") || n.includes("bayesian") || n.includes("21") || n.includes("araña") || n.includes("arana") || n.includes("concentrado") || n.includes("martillo") || n.includes("scott") || n.includes("predicador")), profile: PROFILES.bicepsCurl },
  // Cualquier "curl" que llegue hasta aquí ya pasó por los específicos de
  // arriba (femoral, nórdico, antebrazo) — lo que queda es bíceps por
  // descarte ("Curl en polea alta", "Dead curl", variantes sin la palabra
  // "bíceps" en el nombre pero que lo son en la práctica).
  { test: (n) => n.includes("curl"), profile: PROFILES.bicepsCurl },

  { test: (n) => n.includes("abdominales") || n.includes("crunch") || n.includes("encogimientos") || n.includes("rueda abdominal"), profile: PROFILES.absCrunch },
  { test: (n) => n.includes("oblicuos"), profile: PROFILES.obliques },
  { test: (n) => n.includes("pallof"), profile: PROFILES.antiRotationCore },
  { test: (n) => n.includes("plancha"), profile: PROFILES.plank },

  { test: (n) => n.includes("aguantar colgado") || n.includes("sostener mancuernas"), profile: PROFILES.grip },

  // Cardio/acondicionamiento — sin pretensión de precisión muscular.
  { test: (n) =>
      [
        "airbike", "bici", "cinta", "correr", "trotar", "stepper", "escaleras",
        "skierg", "rowerg", "jumping jacks", "burpees", "mountain climbers",
        "butt kicks", "skipping", "comba", "desplazamientos laterales",
        "golpear al saco", "empujar cajón", "empujar cajon", "rope training",
        "botar pelota", "salto al cajón", "salto al cajon", "con salto",
      ].some((kw) => n.includes(kw)),
    profile: PROFILES.lowerBodyConditioning,
  },
];

/**
 * Devuelve la sugerencia por defecto para un nombre de ejercicio, o `null`
 * si ningún patrón conocido encaja (mejor no sugerir nada que inventar un
 * valor sin ninguna base).
 */
function getDefaultScoreForName(exerciseName) {
  const name = String(exerciseName || "").toLowerCase().trim();
  if (!name) return null;

  for (const rule of RULES) {
    if (!rule.test(name)) continue;
    const profile = typeof rule.profile === "function" ? rule.profile(name) : rule.profile;
    return {
      muscleScores: profile.muscleScores.map((entry) => ({ ...entry })),
      jointScores: profile.jointScores.map((entry) => ({ ...entry })),
    };
  }

  return null;
}

module.exports = {
  getDefaultScoreForName,
};
