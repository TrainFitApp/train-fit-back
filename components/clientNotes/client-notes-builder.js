// PURO — sin Mongo ni Express. Convierte los documentos (lean) de las seis
// fuentes de notas del cliente en una lista homogénea y le aplica leído,
// filtros y paginación. El DAO solo carga; toda la decisión vive aquí para
// poder probarla con node:test.
const crypto = require("crypto");

const DOMAIN_BY_SOURCE = {
  workout: "training",
  exercise: "training",
  pinned: "training",
  pain: "training",
  dietDay: "nutrition",
  meal: "nutrition",
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function noteKey(sourceType, sourceId) {
  return `${sourceType}:${sourceId}`;
}

function textHash(text) {
  return crypto.createHash("sha1").update(String(text || "").trim()).digest("hex");
}

function hasText(value) {
  return typeof value === "string" && value.trim() !== "";
}

function byId(docs) {
  const map = new Map();
  for (const doc of docs || []) {
    if (doc && doc._id) map.set(String(doc._id), doc);
  }
  return map;
}

// Fecha por la que se ordena: la del contexto (sesión hecha, día de dieta,
// registro de dolor), que es la que le importa al entrenador. Ninguna de las
// fuentes guarda cuándo se escribió la nota en sí.
function toSortDate(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dayLabel(workout, workoutIndex) {
  const name = workout && hasText(workout.name) ? workout.name.trim() : "";
  return name ? `Día ${workoutIndex + 1}: ${name}` : `Día ${workoutIndex + 1}`;
}

function routineLabel(table) {
  return `Rutina: ${table && hasText(table.name) ? table.name.trim() : "sin nombre"}`;
}

function exerciseLabel(customExercise, exercisesById) {
  const exercise = customExercise && exercisesById.get(String(customExercise.exercise));
  return exercise && hasText(exercise.name) ? exercise.name.trim() : "Ejercicio";
}

function makeNote(sourceType, sourceId, text, date, path, target) {
  const clean = String(text).trim();
  return {
    key: noteKey(sourceType, sourceId),
    sourceType,
    sourceId: String(sourceId),
    domain: DOMAIN_BY_SOURCE[sourceType],
    text: clean,
    hash: textHash(clean),
    date: toSortDate(date),
    path,
    target,
  };
}

// Tabla → microciclos (splits) → días (workouts) → ejercicios. "Microciclo N"
// y "Día N" salen de la posición, igual que en el Planificador.
function buildTrainingNotes({ tables = [], splits = [], workouts = [], customExercises = [], exercises = [], pinnedNotes = [] } = {}) {
  const splitsById = byId(splits);
  const workoutsById = byId(workouts);
  const customExercisesById = byId(customExercises);
  const exercisesById = byId(exercises);
  const tablesById = byId(tables);
  const notes = [];

  for (const table of tables) {
    const tableId = String(table._id);
    (table.splits || []).forEach((splitRef, splitIndex) => {
      const split = splitsById.get(String(splitRef));
      if (!split) return;
      const splitId = String(split._id);
      const microLabel = `Microciclo ${splitIndex + 1}`;

      (split.workouts || []).forEach((workoutRef, workoutIndex) => {
        const workout = workoutsById.get(String(workoutRef));
        if (!workout) return;
        const workoutId = String(workout._id);
        const sessionDate = workout.date || workout.createdAt;
        const basePath = ["Entrenamiento", routineLabel(table), microLabel, dayLabel(workout, workoutIndex)];

        if (hasText(workout.notes)) {
          notes.push(
            makeNote("workout", workoutId, workout.notes, sessionDate, [...basePath, "Nota de la sesión"], {
              type: "planner", tableId, splitId, workoutId, exerciseId: null,
            })
          );
        }

        for (const exerciseRef of workout.exercises || []) {
          const customExercise = customExercisesById.get(String(exerciseRef));
          if (!customExercise || !hasText(customExercise.clientNotes)) continue;
          const exerciseId = String(customExercise._id);
          notes.push(
            makeNote(
              "exercise",
              exerciseId,
              customExercise.clientNotes,
              sessionDate,
              [...basePath, exerciseLabel(customExercise, exercisesById)],
              { type: "planner", tableId, splitId, workoutId, exerciseId }
            )
          );
        }
      });
    });
  }

  // Una nota fijada vale para la misma fila en TODOS los microciclos, así que
  // no tiene un microciclo propio: se nombra con el primero que tenga esa
  // posición y se lleva allí al pulsarla.
  for (const pinned of pinnedNotes) {
    if (!hasText(pinned.notes)) continue;
    const table = tablesById.get(String(pinned.tableId));
    if (!table) continue;
    const tableId = String(table._id);
    let anchor = null;
    for (const splitRef of table.splits || []) {
      const split = splitsById.get(String(splitRef));
      const workout = split && workoutsById.get(String((split.workouts || [])[pinned.workoutIndex]));
      const customExercise = workout && customExercisesById.get(String((workout.exercises || [])[pinned.exerciseIndex]));
      if (customExercise) {
        anchor = { split, workout, customExercise };
        break;
      }
    }
    const path = ["Entrenamiento", routineLabel(table), "Todos los microciclos"];
    if (anchor) {
      path.push(dayLabel(anchor.workout, pinned.workoutIndex), exerciseLabel(anchor.customExercise, exercisesById));
    } else {
      path.push(`Día ${pinned.workoutIndex + 1}`, `Ejercicio ${pinned.exerciseIndex + 1}`);
    }
    notes.push(
      makeNote("pinned", pinned._id, pinned.notes, pinned.updatedAt || pinned.createdAt, [...path, "Nota fijada"], {
        type: "planner",
        tableId,
        splitId: anchor ? String(anchor.split._id) : null,
        workoutId: anchor ? String(anchor.workout._id) : null,
        exerciseId: anchor ? String(anchor.customExercise._id) : null,
      })
    );
  }

  return notes;
}

function buildPainNotes(painEntries = []) {
  return painEntries
    .filter((entry) => hasText(entry.note))
    .map((entry) =>
      makeNote("pain", entry._id, entry.note, entry.date, ["Entrenamiento", "Dolor", `${entry.zone} · ${entry.level}/10`], {
        type: "pain",
        date: entry.date,
        zone: entry.zone,
      })
    );
}

function buildNutritionNotes({ dietDays = [], meals = [] } = {}) {
  const mealsById = byId(meals);
  const notes = [];
  for (const day of dietDays) {
    const menu = hasText(day.menuName) ? [`Menú: ${day.menuName.trim()}`] : [];
    if (hasText(day.notes)) {
      notes.push(
        makeNote("dietDay", day._id, day.notes, day.date, ["Nutrición", ...menu, "Nota del día"], {
          type: "nutrition", date: day.date, mealId: null,
        })
      );
    }
    for (const mealRef of day.meals || []) {
      const meal = mealsById.get(String(mealRef));
      if (!meal || !hasText(meal.notes)) continue;
      notes.push(
        makeNote("meal", meal._id, meal.notes, day.date, ["Nutrición", ...menu, hasText(meal.name) ? meal.name.trim() : "Comida"], {
          type: "nutrition", date: day.date, mealId: String(meal._id),
        })
      );
    }
  }
  return notes;
}

function sortNotes(notes) {
  return [...notes].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
}

// reads: [{ noteKey, textHash }]. Vista = hay lectura con el texto actual.
function applyReadState(notes, reads = []) {
  const seenHash = new Map(reads.map((read) => [read.noteKey, read.textHash]));
  return notes.map((note) => ({ ...note, seen: seenHash.get(note.key) === note.hash }));
}

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// scopes: los de la relación de ESTE entrenador. Sin scope de un ámbito, sus
// notas no existen para él (mismo criterio que las pestañas de la ficha).
function filterNotes(notes, { scopes = [], domain = null, seen = null, q = "" } = {}) {
  const allowed = new Set(scopes);
  const query = normalize(q).trim();
  return notes.filter((note) => {
    if (!allowed.has(note.domain)) return false;
    if (domain && note.domain !== domain) return false;
    if (seen !== null && note.seen !== seen) return false;
    if (query && !normalize(`${note.text} ${note.path.join(" ")}`).includes(query)) return false;
    return true;
  });
}

function countUnseen(notes) {
  const counts = { total: 0, training: 0, nutrition: 0 };
  for (const note of notes) {
    if (note.seen) continue;
    counts.total += 1;
    counts[note.domain] += 1;
  }
  return counts;
}

function paginate(notes, { page = 0, limit = DEFAULT_LIMIT } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const safePage = Math.max(Number(page) || 0, 0);
  const start = safePage * safeLimit;
  const items = notes.slice(start, start + safeLimit).map(({ hash, ...rest }) => rest);
  return { items, total: notes.length, page: safePage, limit: safeLimit, hasMore: start + safeLimit < notes.length };
}

module.exports = {
  DOMAIN_BY_SOURCE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  noteKey,
  textHash,
  buildTrainingNotes,
  buildPainNotes,
  buildNutritionNotes,
  sortNotes,
  applyReadState,
  filterNotes,
  countUnseen,
  paginate,
};
