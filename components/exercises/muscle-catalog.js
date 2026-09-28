// Catálogo muscular de los ejercicios — dos niveles y énfasis (2026-09).
//
// Espejo EXACTO de packages/shared-core/src/app/core/constants/muscle-catalog.ts
// (frontend). Si tocas uno, toca el otro.
//
// POR QUÉ DOS NIVELES
// El GRUPO es la unidad sobre la que un entrenador decide volumen
// ("¿le doy 10-20 series de pectoral esta semana?"). La PORCIÓN es dónde cae
// el énfasis dentro de ese grupo (superior / medio / inferior). Por eso cada
// grupo es un músculo funcional con su propio rango de volumen — Bíceps y
// Tríceps son grupos distintos, no "porciones de Brazos": un rango de 10-20
// para "Brazos" diría que 20 series de tríceps y 0 de bíceps están bien.
//
// Solo hay porciones donde la evidencia permite ENFATIZARLAS eligiendo
// ejercicio (p. ej. extensiones por encima de la cabeza y cabeza larga del
// tríceps, Maeo 2022; extensión de rodilla y recto femoral, Maeo 2021;
// press inclinado y porción clavicular del pectoral). Donde no hay forma
// real de sesgar el estímulo (isquiosurales, aductores, lumbar) el grupo no
// tiene porciones: inventarlas sería precisión falsa.
//
// POR QUÉ ROLES Y NO UNA LISTA DE "PRINCIPALES/SECUNDARIOS" SUELTA
// En un ejercicio siempre se activan varios músculos; lo que importa al
// programar es cuánto cuenta cada uno. Se usa el conteo de series
// fraccionales (Pelland et al. 2024): el músculo objetivo suma la serie
// entera, el que colabora de forma relevante suma media, y el que solo
// estabiliza se muestra pero no suma volumen.
//
// COMPATIBILIDAD
// muscleGroups1/muscleGroups2 siguen existiendo porque los leen el buscador,
// la app cliente y el progreso del cliente (training-service.js). Ya no se
// editan a mano: se proyectan desde `muscles` con toLegacyMuscleGroups, en
// el vocabulario antiguo que ya traduce es-en-db.map.ts.

const MUSCLE_ROLES = {
  primary: 1,
  secondary: 0.5,
  stabilizer: 0,
};

const ROLE_IDS = Object.keys(MUSCLE_ROLES);

// `region` es la etiqueta antigua de zona ("Piernas", "Brazos"…) que el
// buscador y la app cliente siguen usando como primer nivel de filtro.
// `legacy` es la etiqueta antigua más cercana al grupo o a la porción.
const MUSCLE_GROUPS = [
  {
    id: "chest",
    label: "Pectoral",
    region: "Pectoral",
    legacy: "Pectoral",
    muscles: [
      { id: "chest_upper", label: "Pectoral superior", legacy: "Pectoral superior" },
      { id: "chest_middle", label: "Pectoral medio", legacy: "Pectoral" },
      { id: "chest_lower", label: "Pectoral inferior", legacy: "Pectoral inferior" },
    ],
  },
  {
    id: "back",
    label: "Espalda",
    region: "Espalda",
    legacy: "Espalda alta",
    muscles: [
      { id: "back_lats", label: "Dorsal ancho", legacy: "Espalda alta" },
      { id: "back_mid_traps", label: "Trapecio medio y romboides", legacy: "Espalda alta" },
      { id: "back_upper_traps", label: "Trapecio superior", legacy: "Espalda alta" },
    ],
  },
  {
    id: "shoulders",
    label: "Hombro",
    region: "Hombro",
    legacy: "Hombro",
    muscles: [
      { id: "delt_front", label: "Deltoides anterior", legacy: "Deltoides anterior" },
      { id: "delt_side", label: "Deltoides lateral", legacy: "Deltoides lateral" },
      { id: "delt_rear", label: "Deltoides posterior", legacy: "Deltoides posterior" },
    ],
  },
  {
    id: "biceps",
    label: "Bíceps",
    region: "Brazos",
    legacy: "Bíceps",
    muscles: [
      { id: "biceps_long", label: "Cabeza larga", legacy: "Bíceps" },
      { id: "biceps_short", label: "Cabeza corta", legacy: "Bíceps" },
      { id: "biceps_brachialis", label: "Braquial y braquiorradial", legacy: "Bíceps" },
    ],
  },
  {
    id: "triceps",
    label: "Tríceps",
    region: "Brazos",
    legacy: "Tríceps",
    muscles: [
      { id: "triceps_long", label: "Cabeza larga", legacy: "Tríceps" },
      { id: "triceps_lateral_medial", label: "Cabezas lateral y medial", legacy: "Tríceps" },
    ],
  },
  {
    id: "forearms",
    label: "Antebrazo",
    region: "Brazos",
    legacy: "Antebrazo",
    muscles: [
      { id: "forearm_flexors", label: "Flexores y agarre", legacy: "Antebrazo" },
      { id: "forearm_extensors", label: "Extensores", legacy: "Antebrazo" },
    ],
  },
  {
    id: "abs",
    label: "Abdomen",
    region: "Abdomen",
    legacy: "Abdomen",
    muscles: [
      { id: "abs_rectus", label: "Recto abdominal", legacy: "Recto abdominal" },
      { id: "abs_obliques", label: "Oblicuos", legacy: "Oblicuos" },
    ],
  },
  { id: "lower_back", label: "Lumbar", region: "Espalda", legacy: "Espalda baja", muscles: [] },
  {
    id: "quads",
    label: "Cuádriceps",
    region: "Piernas",
    legacy: "Cuádriceps",
    muscles: [
      { id: "quads_rectus_femoris", label: "Recto femoral", legacy: "Cuádriceps" },
      { id: "quads_vasti", label: "Vastos", legacy: "Cuádriceps" },
    ],
  },
  { id: "hamstrings", label: "Isquiosurales", region: "Piernas", legacy: "Femoral", muscles: [] },
  {
    id: "glutes",
    label: "Glúteo",
    region: "Piernas",
    legacy: "Glúteo",
    muscles: [
      { id: "glute_max", label: "Glúteo mayor", legacy: "Glúteo" },
      { id: "glute_med", label: "Glúteo medio y menor", legacy: "Glúteo" },
    ],
  },
  { id: "adductors", label: "Aductores", region: "Piernas", legacy: "Aductor", muscles: [] },
  {
    id: "calves",
    label: "Gemelos y sóleo",
    region: "Piernas",
    legacy: "Gemelo",
    muscles: [
      { id: "calves_gastrocnemius", label: "Gemelo", legacy: "Gemelo" },
      { id: "calves_soleus", label: "Sóleo", legacy: "Sóleo" },
    ],
  },
  { id: "neck", label: "Cuello", region: "Cuello", legacy: "Cuello", muscles: [] },
];

// id -> { id, label, legacy, groupId, isGroup }
const NODES = new Map();
for (const group of MUSCLE_GROUPS) {
  NODES.set(group.id, {
    id: group.id,
    label: group.label,
    legacy: group.legacy,
    groupId: group.id,
    isGroup: true,
  });
  for (const muscle of group.muscles) {
    NODES.set(muscle.id, { ...muscle, groupId: group.id, isGroup: false });
  }
}

// Se puede etiquetar tanto una porción como el grupo entero ("pectoral en
// general"): no todos los ejercicios sesgan una porción, y forzar una sería
// mentir sobre el ejercicio.
const MUSCLE_IDS = [...NODES.keys()];

const GROUP_BY_ID = new Map(MUSCLE_GROUPS.map((group) => [group.id, group]));
const CATALOG_ORDER = new Map(MUSCLE_IDS.map((id, index) => [id, index]));

function getNode(id) {
  return NODES.get(id) || null;
}

function groupOf(id) {
  const node = NODES.get(id);
  return node ? GROUP_BY_ID.get(node.groupId) : null;
}

/**
 * Deja `muscles` en forma canónica: solo ids y roles válidos, un único rol
 * por músculo (gana el de más peso: si alguien marca el mismo músculo como
 * principal y secundario, es principal) y en orden rol → catálogo, para que
 * dos ejercicios iguales se guarden igual.
 */
function normalizeMuscles(input) {
  if (!Array.isArray(input)) return [];

  const byMuscle = new Map();
  for (const item of input) {
    const muscle = typeof item?.muscle === "string" ? item.muscle.trim() : "";
    const role = typeof item?.role === "string" ? item.role.trim() : "";
    if (!NODES.has(muscle) || !ROLE_IDS.includes(role)) continue;

    const current = byMuscle.get(muscle);
    if (!current || MUSCLE_ROLES[role] > MUSCLE_ROLES[current]) {
      byMuscle.set(muscle, role);
    }
  }

  return [...byMuscle.entries()]
    .map(([muscle, role]) => ({ muscle, role }))
    .sort(
      (a, b) =>
        ROLE_IDS.indexOf(a.role) - ROLE_IDS.indexOf(b.role) ||
        CATALOG_ORDER.get(a.muscle) - CATALOG_ORDER.get(b.muscle),
    );
}

function uniquePush(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

/**
 * Proyección al modelo antiguo, con la misma forma que ya tenían los datos:
 * muscleGroups1 = zonas + músculos principales ("Piernas", "Cuádriceps"),
 * muscleGroups2 = secundarios. Los estabilizadores no se proyectan: el
 * modelo antiguo no sabía expresarlos y contarlos como secundarios
 * inflaría el progreso del cliente.
 */
function toLegacyMuscleGroups(muscles) {
  const normalized = normalizeMuscles(muscles);
  const muscleGroups1 = [];
  const muscleGroups2 = [];

  const primaries = normalized.filter((item) => item.role === "primary");
  for (const { muscle } of primaries) uniquePush(muscleGroups1, groupOf(muscle).region);
  for (const { muscle } of primaries) uniquePush(muscleGroups1, getNode(muscle).legacy);

  for (const { muscle } of normalized.filter((item) => item.role === "secondary")) {
    const legacy = getNode(muscle).legacy;
    if (!muscleGroups1.includes(legacy)) uniquePush(muscleGroups2, legacy);
  }

  return { muscleGroups1, muscleGroups2 };
}

// --- Lectura del vocabulario antiguo ---
//
// Los datos antiguos traen erratas ("Delotides", "poterior"), mayúsculas
// sueltas, espacios y varios valores en una sola cadena ("Espalda, Femoral").
// Las zonas ("Piernas", "Brazos") no dicen qué músculo es y se descartan: si
// es lo único que hay, el ejercicio queda para revisión manual.

function normalizeLegacyText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const LEGACY_TO_MUSCLE = {
  pectoral: "chest",
  pecho: "chest",
  "pectoral superior": "chest_upper",
  "pectoral inferior": "chest_lower",
  espalda: "back",
  "espalda alta": "back",
  "espalda baja": "lower_back",
  hombro: "shoulders",
  hombros: "shoulders",
  "deltoides anterior": "delt_front",
  "delotides anterior": "delt_front",
  "deltoides lateral": "delt_side",
  "delotides lateral": "delt_side",
  "deltoides posterior": "delt_rear",
  "deltoides poterior": "delt_rear",
  biceps: "biceps",
  triceps: "triceps",
  antebrazo: "forearms",
  abdomen: "abs",
  core: "abs",
  "recto abdominal": "abs_rectus",
  oblicuos: "abs_obliques",
  gluteo: "glutes",
  cuadriceps: "quads",
  femoral: "hamstrings",
  aductor: "adductors",
  aductores: "adductors",
  gemelo: "calves_gastrocnemius",
  gemelos: "calves_gastrocnemius",
  soleo: "calves_soleus",
  cuello: "neck",
};

const LEGACY_REGIONS = new Set(["piernas", "pierna", "brazos"]);

function splitLegacy(values) {
  return (Array.isArray(values) ? values : [])
    .flatMap((value) => String(value || "").split(","))
    .map(normalizeLegacyText)
    .filter(Boolean);
}

/**
 * Traduce muscleGroups1/2 antiguos a `muscles` (principal / secundario).
 * Devuelve también lo que no se pudo interpretar, para que la migración lo
 * liste en vez de perderlo en silencio.
 */
function fromLegacyMuscleGroups(muscleGroups1, muscleGroups2) {
  const unknown = [];
  const collect = (values, role) =>
    splitLegacy(values).flatMap((text) => {
      if (LEGACY_REGIONS.has(text)) return [];
      const muscle = LEGACY_TO_MUSCLE[text];
      if (!muscle) {
        unknown.push(text);
        return [];
      }
      return [{ muscle, role }];
    });

  let muscles = normalizeMuscles([
    ...collect(muscleGroups1, "primary"),
    ...collect(muscleGroups2, "secondary"),
  ]);

  // "Espalda, Espalda alta" o "Pectoral, Pectoral superior": el grupo al
  // lado de una de sus porciones es la forma antigua de decir "esta
  // porción"; conservar los dos contaría el grupo dos veces. Solo se quita
  // el grupo si la porción pesa lo mismo o más: "Pectoral" principal con
  // "Pectoral superior" secundario sigue siendo pectoral en general.
  const roleOf = new Map(muscles.map((item) => [item.muscle, item.role]));
  muscles = muscles.filter(
    ({ muscle, role }) =>
      !getNode(muscle).isGroup ||
      !groupOf(muscle).muscles.some(
        (child) =>
          roleOf.has(child.id) && MUSCLE_ROLES[roleOf.get(child.id)] >= MUSCLE_ROLES[role],
      ),
  );

  return { muscles, unknown };
}

/**
 * Ids que casan con un filtro de búsqueda por músculo: un grupo incluye sus
 * porciones ("Pectoral" encuentra el press inclinado, etiquetado como
 * pectoral superior); una porción es solo ella (buscar "pectoral superior"
 * no debe traer un press plano etiquetado como pectoral en general).
 */
function expandMuscleFilter(ids) {
  const expanded = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    const node = NODES.get(id);
    if (!node) continue;
    expanded.add(id);
    if (node.isGroup) {
      for (const child of GROUP_BY_ID.get(id).muscles) expanded.add(child.id);
    }
  }
  return [...expanded];
}

module.exports = {
  MUSCLE_ROLES,
  ROLE_IDS,
  MUSCLE_GROUPS,
  MUSCLE_IDS,
  getNode,
  groupOf,
  normalizeMuscles,
  toLegacyMuscleGroups,
  fromLegacyMuscleGroups,
  normalizeLegacyText,
  expandMuscleFilter,
};
