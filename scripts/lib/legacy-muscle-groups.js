// Lectura del vocabulario muscular ANTIGUO de Exercise (muscleGroups1 =
// principales, muscleGroups2 = secundarios, etiquetas en texto libre). Solo
// lo usa la migración a `muscles` (migrate-exercise-muscles.js): la app ya
// no guarda ni lee esos campos.
//
// Los datos antiguos traen erratas ("Delotides", "poterior"), mayúsculas
// sueltas, espacios y varios valores en una sola cadena ("Espalda, Femoral").
// Las zonas ("Piernas", "Brazos") no dicen qué músculo es y se descartan: si
// es lo único que hay, el ejercicio queda para revisión manual.

const {
  MUSCLE_ROLES,
  getNode,
  groupOf,
  normalizeMuscles,
} = require("../../components/exercises/muscle-catalog");

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

module.exports = { normalizeLegacyText, fromLegacyMuscleGroups };
