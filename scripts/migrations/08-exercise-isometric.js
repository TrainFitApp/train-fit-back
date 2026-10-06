// Marca con `isIsometric: true` los ejercicios del catálogo global (sin
// userId) que se registran por tiempo de aguante y no por repeticiones. Con
// ese flag las estadísticas del ejercicio leen `timeSeconds` en vez de kg.
//
// Lista revisada sobre la copia de PRO (2026-09-30). Se casa por nombre
// normalizado, no por _id, para que sirva igual en PRO, PRE y local.
// Idempotente: solo escribe en los que aún no lo tienen a true.

const ISOMETRIC_EXERCISES = [
  "Sostener mancuernas",
  "Aguantar colgado en barra",
  "Plancha",
  "Plancha lateral oblicuos",
  "Plancha lateral aductor",
];

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

async function migrateExerciseIsometric(db, { dryRun = false, log = () => {} } = {}) {
  const exercises = db.collection("exercises");
  const catalog = await exercises.find({ userId: null }, { projection: { name: 1, isIsometric: 1 } }).toArray();

  const byName = new Map();
  for (const exercise of catalog) {
    const key = normalizeName(exercise.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(exercise);
  }

  const toUpdate = [];
  const missing = [];
  for (const name of ISOMETRIC_EXERCISES) {
    const matches = byName.get(normalizeName(name)) || [];
    if (!matches.length) missing.push(name);
    for (const exercise of matches) {
      if (exercise.isIsometric !== true) toUpdate.push(exercise._id);
    }
  }
  for (const name of missing) log(`no encontrado en el catálogo: ${name}`);

  if (!dryRun && toUpdate.length) {
    await exercises.updateMany({ _id: { $in: toUpdate } }, { $set: { isIsometric: true } });
  }
  return { catalog: catalog.length, marked: toUpdate.length, missing: missing.length };
}

module.exports = { migrateExerciseIsometric };
