// Relación profesional ↔ cliente como par (2026-10, docs/refactor-modelo-datos-estado.md C1).
//
// Antes:  trainerclients con un documento por scope e invitación
//         ({ trainerId, clientId?, clientEmail, scope, status, … }) y el
//         cuestionario de alta en su propia colección (clientintakes).
// Ahora:  trainerclients con UN documento por (trainerId, clientEmail):
//         { trainerId, clientEmail, clientId?, scopes: [{ _id, scope, status,
//         invitedAt, respondedAt, revokedAt, revokedBy }], intakePending,
//         intake, mediaHistory…, trainingGoalType }.
//
// - Cada documento viejo pasa a ser una entrada de `scopes` con el mismo
//   `_id` (los ids de invitación no cambian). El par toma el `_id` de su
//   documento más antiguo.
// - Estados retirados: "cuestionario_pendiente" pasa a "active" con el
//   cuestionario pendiente; "en_revision", a "active" (ya lo había enviado).
// - El texto libre viejo `equipment` del cuestionario se conserva como una
//   respuesta propia ("Material") si no hay datos estructurados.
// - Umbrales de dolor (painthresholds) y vídeos de técnica asignados a un
//   cliente (techniquevideooverrides) pasan al par: painThresholds[] y
//   techniqueOverrides[] (C3). `--drop-old` borra también esas colecciones.
// - Preguntas propias con tipo (C2): las del cuestionario de cada
//   profesional (users.trainerSettings.intake.customQuestions) y sus
//   respuestas eran solo texto: pasan a `type: "text"`.
// - Idempotente y reanudable: solo lee documentos con `scope` en la raíz y
//   une sus entradas con el par que ya exista. Al final deja los índices del
//   schema nuevo.

const LOG_PREFIX = "[migrate-trainer-client-pairs]";

const OPEN = ["pending", "active"];
const RETIRED_STATUSES = {
  cuestionario_pendiente: { status: "active", intakePending: true },
  en_revision: { status: "active", intakePending: false },
};
const INTAKE_FIELDS = [
  "goals",
  "healthConditions",
  "experienceLevel",
  "availability",
  "trainingLocation",
  "equipmentTags",
  "customAnswers",
  "submittedAt",
  "reviewedAt",
];
const NEW_INDEXES = [
  { key: { trainerId: 1, clientEmail: 1 }, name: "trainerId_1_clientEmail_1", unique: true },
  {
    key: { trainerId: 1, clientId: 1 },
    name: "trainerId_1_clientId_1",
    unique: true,
    partialFilterExpression: { clientId: { $exists: true } },
  },
  { key: { clientId: 1 }, name: "clientId_1" },
  { key: { clientEmail: 1 }, name: "clientEmail_1" },
];

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();
const time = (value) => (value ? new Date(value).getTime() : 0);
const latest = (values) => values.filter(Boolean).sort((a, b) => time(b) - time(a))[0] || null;

// Documentos viejos agrupados por persona: mismo profesional y mismo email,
// y unidos si comparten cliente (por si el mismo cliente quedó con dos emails).
function groupByPair(legacy) {
  const byEmail = new Map();
  for (const doc of legacy) {
    const key = `${doc.trainerId}:${normalizeEmail(doc.clientEmail)}`;
    if (!byEmail.has(key)) byEmail.set(key, { trainerId: doc.trainerId, email: normalizeEmail(doc.clientEmail), clientId: null, docs: [] });
    const group = byEmail.get(key);
    group.docs.push(doc);
    if (doc.clientId && !group.clientId) group.clientId = doc.clientId;
  }
  const byClient = new Map();
  const groups = [];
  for (const group of byEmail.values()) {
    const key = group.clientId ? `${group.trainerId}:${group.clientId}` : null;
    if (key && byClient.has(key)) {
      byClient.get(key).docs.push(...group.docs);
      continue;
    }
    if (key) byClient.set(key, group);
    groups.push(group);
  }
  return groups;
}

function linkOf(doc) {
  const retired = RETIRED_STATUSES[doc.status];
  return {
    _id: doc._id,
    scope: doc.scope,
    status: retired ? retired.status : doc.status,
    invitedAt: doc.invitedAt || doc._id.getTimestamp(),
    respondedAt: doc.respondedAt || null,
    revokedAt: doc.revokedAt || null,
    revokedBy: doc.revokedBy || null,
  };
}

// Como mucho una entrada abierta por scope: si los datos viejos traían más
// (dos emails del mismo cliente), se queda la más reciente y el resto se cierra.
function closeDuplicateOpenLinks(links, now) {
  let closed = 0;
  for (const scope of ["training", "nutrition"]) {
    const open = links
      .filter((link) => link.scope === scope && OPEN.includes(link.status))
      .sort((a, b) => Number(b.status === "active") - Number(a.status === "active") || time(b.invitedAt) - time(a.invitedAt));
    for (const link of open.slice(1)) {
      if (link.status === "active") Object.assign(link, { status: "revoked", revokedAt: now, revokedBy: null });
      else Object.assign(link, { status: "declined", respondedAt: now });
      closed += 1;
    }
  }
  return closed;
}

function intakeOf(oldIntake, stats) {
  if (!oldIntake) return null;
  const intake = Object.fromEntries(INTAKE_FIELDS.map((field) => [field, oldIntake[field] ?? null]));
  intake.goals = intake.goals || "";
  intake.healthConditions = intake.healthConditions || "";
  intake.availability = intake.availability || "";
  intake.equipmentTags = intake.equipmentTags || [];
  intake.customAnswers = (intake.customAnswers || []).map((answer) => ({
    questionId: answer.questionId,
    label: answer.label,
    type: answer.type || "text",
    unit: answer.unit || "",
    value: answer.value ?? "",
  }));
  intake.submittedAt = intake.submittedAt || oldIntake._id.getTimestamp();
  const legacyEquipment = String(oldIntake.equipment || "").trim();
  if (legacyEquipment && !intake.trainingLocation && !intake.equipmentTags.length) {
    intake.customAnswers = [
      ...intake.customAnswers,
      { questionId: "legacy-equipment", label: "Material", type: "text", unit: "", value: legacyEquipment },
    ];
    stats.legacyEquipment += 1;
  }
  return intake;
}

async function migrateTrainerClientPairs(db, { dryRun = false, dropOld = false } = {}) {
  const relations = db.collection("trainerclients");
  const intakes = db.collection("clientintakes");
  const users = db.collection("users");
  const now = new Date();

  const legacy = await relations.find({ scope: { $exists: true } }).toArray();
  const groups = groupByPair(legacy);
  const stats = {
    relations: legacy.length,
    pairs: groups.length,
    retiredStatuses: legacy.filter((doc) => RETIRED_STATUSES[doc.status]).length,
    duplicateOpenClosed: 0,
    painThresholds: { read: 0, embedded: 0, alreadyThere: 0, orphan: 0 },
    techniqueOverrides: { read: 0, embedded: 0, alreadyThere: 0, orphan: 0 },
    typedQuestions: 0,
    intakes: 0,
    legacyEquipment: 0,
    droppedCollections: [],
  };

  for (const group of groups) {
    const emailOfClient = group.clientId
      ? normalizeEmail((await users.findOne({ _id: group.clientId }, { projection: { email: 1 } }))?.email)
      : "";
    const email = emailOfClient || group.email;
    const existing = await relations.findOne({
      trainerId: group.trainerId,
      scope: { $exists: false },
      $or: [{ clientEmail: email }, ...(group.clientId ? [{ clientId: group.clientId }] : [])],
    });

    const linksById = new Map((existing?.scopes || []).map((link) => [String(link._id), link]));
    for (const doc of group.docs) linksById.set(String(doc._id), linkOf(doc));
    const links = [...linksById.values()].sort((a, b) => time(a.invitedAt) - time(b.invitedAt));
    stats.duplicateOpenClosed += closeDuplicateOpenLinks(links, now);

    const activeDocs = group.docs.filter((doc) => linkOf(doc).status === "active");
    const intakePending = links.some((link) => link.status === "active")
      ? Boolean(existing?.intakePending) ||
        activeDocs.some((doc) => doc.intakePending === true || RETIRED_STATUSES[doc.status]?.intakePending === true)
      : false;
    const oldIntake = group.clientId ? await intakes.findOne({ trainerId: group.trainerId, clientId: group.clientId }) : null;
    const intake = existing?.intake || intakeOf(oldIntake, stats);
    if (intake) stats.intakes += 1;

    const oldest = [...group.docs].sort((a, b) => time(a.invitedAt) - time(b.invitedAt) || String(a._id).localeCompare(String(b._id)))[0];
    const pair = {
      _id: existing?._id || oldest._id,
      trainerId: group.trainerId,
      clientEmail: email,
      ...(group.clientId || existing?.clientId ? { clientId: group.clientId || existing.clientId } : {}),
      scopes: links,
      intakePending,
      intake,
      mediaHistorySharedAt: latest([existing?.mediaHistorySharedAt, ...group.docs.map((doc) => doc.mediaHistorySharedAt)]),
      mediaHistoryAskedAt: latest([existing?.mediaHistoryAskedAt, ...group.docs.map((doc) => doc.mediaHistoryAskedAt)]),
      trainingGoalType:
        existing?.trainingGoalType ||
        group.docs.filter((doc) => doc.trainingGoalType).sort((a, b) => time(b.invitedAt) - time(a.invitedAt))[0]?.trainingGoalType ||
        null,
      createdAt: existing?.createdAt || links[0]?.invitedAt || now,
      updatedAt: now,
      __v: existing?.__v || 0,
    };
    if (dryRun) continue;

    // Primero el par (sustituye a su documento más antiguo), después el
    // resto de documentos viejos: si se corta a medias, otra pasada los une.
    await relations.replaceOne({ _id: pair._id }, pair, { upsert: true });
    await relations.deleteMany({ _id: { $in: group.docs.map((doc) => doc._id).filter((id) => String(id) !== String(pair._id)) } });
  }

  // Umbrales de dolor y vídeos asignados: una entrada por zona / ejercicio
  // dentro del par. Sin par (relación borrada a mano) se quedan fuera.
  const moveIntoPair = async (collectionName, field, key, toItem, statsOf) => {
    const docs = await db.collection(collectionName).find({}).toArray();
    statsOf.read = docs.length;
    for (const doc of docs) {
      // En seco los pares aún no existen: vale cualquier relación del par.
      const pairFilter = { trainerId: doc.trainerId, clientId: doc.clientId };
      const pair = await relations.findOne(pairFilter, { projection: { [field]: 1 } });
      if (!pair) {
        statsOf.orphan += 1;
        continue;
      }
      if ((pair[field] || []).some((item) => String(item[key]) === String(doc[key]))) {
        statsOf.alreadyThere += 1;
        continue;
      }
      statsOf.embedded += 1;
      if (!dryRun) {
        await relations.updateOne(
          { _id: pair._id, [`${field}.${key}`]: { $ne: doc[key] } },
          { $push: { [field]: toItem(doc) } }
        );
      }
    }
  };
  await moveIntoPair("painthresholds", "painThresholds", "zone", (doc) => ({
    zone: doc.zone,
    workLevel: doc.workLevel,
    painLevel: doc.painLevel,
    note: doc.note || "",
    updatedAt: doc.updatedAt || doc.createdAt || now,
  }), stats.painThresholds);
  await moveIntoPair("techniquevideooverrides", "techniqueOverrides", "exerciseId", (doc) => ({
    exerciseId: doc.exerciseId,
    techniqueVideoId: doc.techniqueVideoId,
    assignedAt: doc.createdAt || now,
  }), stats.techniqueOverrides);

  // Preguntas propias del cuestionario sin tipo: texto libre.
  const untyped = { "trainerSettings.intake.customQuestions": { $elemMatch: { type: { $exists: false } } } };
  stats.typedQuestions = await users.countDocuments(untyped);
  if (!dryRun && stats.typedQuestions) {
    await users.updateMany(untyped, [
      {
        $set: {
          "trainerSettings.intake.customQuestions": {
            $map: {
              input: "$trainerSettings.intake.customQuestions",
              as: "question",
              in: {
                $mergeObjects: [
                  { type: "text", unit: "", options: [], required: false, enabled: true },
                  "$$question",
                ],
              },
            },
          },
        },
      },
    ]);
  }

  if (!dryRun) {
    const keep = new Set(["_id_", ...NEW_INDEXES.map((index) => index.name)]);
    const current = await relations.indexes().catch(() => []);
    for (const index of current) {
      if (!keep.has(index.name)) await relations.dropIndex(index.name);
    }
    for (const { key, ...options } of NEW_INDEXES) {
      if (!current.some((index) => index.name === options.name)) await relations.createIndex(key, options);
    }
  }

  if (dropOld && !dryRun) {
    const leftovers = await relations.countDocuments({ scope: { $exists: true } });
    if (leftovers) throw new Error(`${LOG_PREFIX} quedan ${leftovers} relaciones sin convertir: no se borra clientintakes`);
    const pending = await intakes.find({}, { projection: { trainerId: 1, clientId: 1 } }).toArray();
    for (const oldIntake of pending) {
      const pair = await relations.findOne({ trainerId: oldIntake.trainerId, clientId: oldIntake.clientId });
      if (pair && !pair.intake) throw new Error(`${LOG_PREFIX} el cuestionario ${oldIntake._id} no está en su par: no se borra clientintakes`);
    }
    for (const name of ["clientintakes", "painthresholds", "techniquevideooverrides"]) {
      if (!(await db.listCollections({ name }).toArray()).length) continue;
      await db.collection(name).drop();
      stats.droppedCollections.push(name);
    }
  }
  return stats;
}

module.exports = { migrateTrainerClientPairs };
