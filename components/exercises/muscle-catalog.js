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

const MUSCLE_ROLES = {
  primary: 1,
  secondary: 0.5,
  stabilizer: 0,
};

const ROLE_IDS = Object.keys(MUSCLE_ROLES);

const MUSCLE_GROUPS = [
  {
    id: "chest",
    label: "Pectoral",
    muscles: [
      { id: "chest_upper", label: "Pectoral superior" },
      { id: "chest_middle", label: "Pectoral medio" },
      { id: "chest_lower", label: "Pectoral inferior" },
    ],
  },
  {
    id: "back",
    label: "Espalda",
    muscles: [
      { id: "back_lats", label: "Dorsal ancho" },
      { id: "back_mid_traps", label: "Trapecio medio y romboides" },
      { id: "back_upper_traps", label: "Trapecio superior" },
    ],
  },
  {
    id: "shoulders",
    label: "Hombro",
    muscles: [
      { id: "delt_front", label: "Deltoides anterior" },
      { id: "delt_side", label: "Deltoides lateral" },
      { id: "delt_rear", label: "Deltoides posterior" },
    ],
  },
  {
    id: "biceps",
    label: "Bíceps",
    muscles: [
      { id: "biceps_long", label: "Cabeza larga" },
      { id: "biceps_short", label: "Cabeza corta" },
      { id: "biceps_brachialis", label: "Braquial y braquiorradial" },
    ],
  },
  {
    id: "triceps",
    label: "Tríceps",
    muscles: [
      { id: "triceps_long", label: "Cabeza larga" },
      { id: "triceps_lateral_medial", label: "Cabezas lateral y medial" },
    ],
  },
  {
    id: "forearms",
    label: "Antebrazo",
    muscles: [
      { id: "forearm_flexors", label: "Flexores y agarre" },
      { id: "forearm_extensors", label: "Extensores" },
    ],
  },
  {
    id: "abs",
    label: "Abdomen",
    muscles: [
      { id: "abs_rectus", label: "Recto abdominal" },
      { id: "abs_obliques", label: "Oblicuos" },
    ],
  },
  { id: "lower_back", label: "Lumbar", muscles: [] },
  {
    id: "quads",
    label: "Cuádriceps",
    muscles: [
      { id: "quads_rectus_femoris", label: "Recto femoral" },
      { id: "quads_vasti", label: "Vastos" },
    ],
  },
  { id: "hamstrings", label: "Isquiosurales", muscles: [] },
  {
    id: "glutes",
    label: "Glúteo",
    muscles: [
      { id: "glute_max", label: "Glúteo mayor" },
      { id: "glute_med", label: "Glúteo medio y menor" },
    ],
  },
  { id: "adductors", label: "Aductores", muscles: [] },
  {
    id: "calves",
    label: "Gemelos y sóleo",
    muscles: [
      { id: "calves_gastrocnemius", label: "Gemelo" },
      { id: "calves_soleus", label: "Sóleo" },
    ],
  },
  { id: "neck", label: "Cuello", muscles: [] },
];

// id -> { id, label, groupId, isGroup }
const NODES = new Map();
for (const group of MUSCLE_GROUPS) {
  NODES.set(group.id, {
    id: group.id,
    label: group.label,
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
  expandMuscleFilter,
};
