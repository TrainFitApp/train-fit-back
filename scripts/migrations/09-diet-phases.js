// Fases de dieta en su propia colección (2026-10, docs/refactor-modelo-datos-estado.md B4).
//
// Antes:  `diettemplates` mezclaba la biblioteca del profesional con las
//         copias asignadas a clientes (`clientId` puesto). Cada semana
//         preparada de una fase era OTRA copia con el mismo `phaseId`, y las
//         asignaciones sin fase ("plan suelto") no tenían `phaseId`.
// Ahora:  `diettemplates` es solo biblioteca, y cada fase es UN documento de
//         `dietphases` con sus versiones de contenido dentro (`contents`). Un
//         plan suelto pasa a ser una fase de una sola versión.
//
// Se conservan los ids: la fase toma el de su primer documento (el que ya era
// `phaseId`, al que apuntan los check-ins), y cada versión del contenido el
// del documento del que sale.
//
// Idempotente: lo que ya está en `dietphases` no se vuelve a crear, y las
// copias migradas se borran de `diettemplates` en la misma pasada. Trabaja con
// las colecciones en crudo, sin modelos. Corre después de migrate-embed-nutrition
// (necesita el contenido ya embebido).


const key = (value) => (value == null ? null : String(value));

// Campos que en una plantilla de biblioteca ya no existen.
const PHASE_FIELDS = [
  "clientId",
  "startDate",
  "endDate",
  "endMode",
  "status",
  "supersededBy",
  "sourceTemplateId",
  "phaseId",
  "phaseName",
  "phaseTarget",
  "phaseProteinPerKg",
  "phaseFatPerKg",
  "phaseNeed",
];

// Alimentos: sin los campos que ya no existen (la comida o receta que los
// contenía, ahora implícita por estar dentro).
function cleanProduct(item) {
  if (!item || typeof item !== "object") return item;
  const { mealId, customRecipeId, ...rest } = item;
  return rest;
}

function cleanRecipe(item) {
  if (!item || typeof item !== "object") return item;
  return {
    ...item,
    addedCustomProducts: (item.addedCustomProducts || []).map(cleanProduct),
    modifiedBaseCustomProducts: (item.modifiedBaseCustomProducts || []).map(cleanProduct),
  };
}

// Menús con la forma de diet-menu-schema.js: sin `_id` en menús, comidas y
// alternativas.
function cleanMenus(menus) {
  return (menus || []).map(({ _id, ...menu }) => ({
    name: menu.name,
    meals: (menu.meals || []).map(({ _id: mealId, ...meal }) => ({
      slot: meal.slot,
      alternatives: (meal.alternatives || []).map((alternative) => ({
        label: alternative.label || "",
        customProducts: (alternative.customProducts || []).map(cleanProduct),
        customRecipes: (alternative.customRecipes || []).map(cleanRecipe),
      })),
    })),
  }));
}

const byStart = (a, b) =>
  String(a.startDate || "").localeCompare(String(b.startDate || "")) ||
  new Date(a.createdAt || 0) - new Date(b.createdAt || 0);

/**
 * Una fase a partir de sus documentos (ya ordenados por inicio). `phaseId` es
 * el id del grupo (el `phaseId` de sus documentos, o el suyo propio si era un
 * plan suelto).
 */
function buildPhase(phaseId, members) {
  const head = members.find((doc) => key(doc._id) === key(phaseId)) || members[0];
  const last = members[members.length - 1];

  // Una versión por fecha de inicio (la más reciente gana) y la primera
  // empieza con la fase.
  const byDate = new Map();
  for (const doc of members) byDate.set(doc.startDate || head.startDate, doc);
  const contents = [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startDate, doc]) => ({ _id: doc._id, startDate, menus: cleanMenus(doc.menus) }));
  contents[0].startDate = head.startDate;

  return {
    _id: phaseId,
    clientId: head.clientId,
    trainerId: head.trainerId ?? null,
    name: head.phaseName || head.name || "Fase",
    sourceTemplateId: head.sourceTemplateId ?? null,
    startDate: head.startDate,
    // El estado de la cadena (status, supersededBy) no se guarda: sale de
    // las fechas (util/phase-chain.js).
    endDate: last.endDate ?? null,
    ...(head.phaseTarget ? { target: head.phaseTarget } : {}),
    proteinPerKg: head.phaseProteinPerKg ?? null,
    fatPerKg: head.phaseFatPerKg ?? null,
    ...(head.phaseNeed ? { need: head.phaseNeed } : {}),
    contents,
    createdAt: head.createdAt || new Date(),
    __v: 0,
  };
}

async function migrateDietPhases(db, { dryRun = false, log = () => {} } = {}) {
  const templates = db.collection("diettemplates");
  const phases = db.collection("dietphases");
  const stats = { phases: 0, contents: 0, alreadyMigrated: 0, removedCopies: 0, templatesCleaned: 0, skippedWithoutStart: 0 };

  // 1) Copias asignadas, agrupadas por fase (sin phaseId, cada una es su fase).
  const copies = await templates.find({ clientId: { $type: "objectId" } }).toArray();
  const groups = new Map();
  for (const doc of copies) {
    const phaseId = doc.phaseId || doc._id;
    if (!groups.has(key(phaseId))) groups.set(key(phaseId), { phaseId, members: [] });
    groups.get(key(phaseId)).members.push(doc);
  }

  const existing = await phases
    .find({ _id: { $in: [...groups.values()].map((group) => group.phaseId) } }, { projection: { _id: 1 } })
    .toArray();
  const migrated = new Set(existing.map((doc) => key(doc._id)));

  const toRemove = [];
  for (const { phaseId, members } of groups.values()) {
    members.sort(byStart);
    const head = members.find((doc) => key(doc._id) === key(phaseId)) || members[0];
    if (!head.startDate) {
      stats.skippedWithoutStart += 1;
      log(`sin fecha de inicio, se deja sin migrar: ${key(phaseId)}`);
      continue;
    }
    toRemove.push(...members.map((doc) => doc._id));
    if (migrated.has(key(phaseId))) {
      stats.alreadyMigrated += 1;
      continue;
    }
    const phase = buildPhase(phaseId, members);
    stats.phases += 1;
    stats.contents += phase.contents.length;
    if (!dryRun) await phases.insertOne(phase);
  }

  stats.removedCopies = toRemove.length;
  if (!dryRun && toRemove.length) await templates.deleteMany({ _id: { $in: toRemove } });

  // 2) Biblioteca: fuera los campos de fase y menús con su forma (solo las que
  // aún tienen algo de la forma vieja).
  const oldShape = {
    clientId: { $not: { $type: "objectId" } },
    $or: [
      ...PHASE_FIELDS.map((field) => ({ [field]: { $exists: true } })),
      { ownerClientId: { $exists: false } },
      { "menus._id": { $exists: true } },
      { "menus.meals._id": { $exists: true } },
      { "menus.meals.alternatives._id": { $exists: true } },
      { "menus.meals.alternatives.customProducts.mealId": { $exists: true } },
      { "menus.meals.alternatives.customProducts.customRecipeId": { $exists: true } },
    ],
  };
  for await (const template of templates.find(oldShape)) {
    stats.templatesCleaned += 1;
    if (dryRun) continue;
    const unset = Object.fromEntries(PHASE_FIELDS.map((field) => [field, ""]));
    await templates.updateOne(
      { _id: template._id },
      {
        $set: { menus: cleanMenus(template.menus), ownerClientId: template.ownerClientId ?? null },
        $unset: unset,
        $inc: { __v: 1 },
      }
    );
  }

  return stats;
}

module.exports = { migrateDietPhases, cleanMenus };
