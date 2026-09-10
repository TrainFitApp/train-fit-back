const Relation = require("../trainerClients/trainer-client-schema");
const Intake = require("../clientIntake/client-intake-schema");
const Note = require("../trainerNotes/trainer-note-schema");
const Task = require("../coachTasks/coach-task-schema");
const { CoachingStage } = require("./overview-schema");
const { groupRelations, CONTEXT_FIELDS, pick, fail, LIVE_STATUSES } = require("./overview-domain");

async function ensureStages(trainerId, clientId) {
  const relations = await Relation.find({ trainerId, clientId }).lean();
  const groups = groupRelations(relations);
  const legacyIntake = await Intake.findOne({ trainerId, clientId }).lean();
  const stages = [];
  for (const group of groups) {
    const intakeDate = legacyIntake?.submittedAt && new Date(legacyIntake.submittedAt).getTime();
    const relevantIntake = intakeDate && intakeDate >= group.start.getTime() && intakeDate <= group.end ? legacyIntake : null;
    let stage;
    const values = { relationIds: group.relations.map((r) => r._id), endedAt: group.end === Infinity ? null : new Date(group.end) };
    try {
      stage = await CoachingStage.findOneAndUpdate({ trainerId, clientId, key: group.key }, {
        $set: values,
        $setOnInsert: { startedAt: group.start, startEstimated: group.estimated, legacy: true, createdAt: new Date(), updatedAt: relevantIntake?.submittedAt || group.start,
          currentContext: relevantIntake ? pick(relevantIntake, CONTEXT_FIELDS) : {},
          intakeSnapshot: relevantIntake ? { legacy: true, submittedAt: relevantIntake.submittedAt, answers: pick(relevantIntake, CONTEXT_FIELDS), questions: [], nutrition: null, note: "Última respuesta disponible del sistema anterior; las preguntas originales y preferencias nutricionales no se pueden reconstruir." } : null },
      }, { new: true, upsert: true, timestamps: false }).lean();
    } catch (e) { if (e.code !== 11000) throw e; stage = await CoachingStage.findOne({ trainerId, clientId, key: group.key }).lean(); }
    stages.push(stage);
    await Relation.updateMany({ _id: { $in: values.relationIds }, stageId: { $ne: stage._id } }, { $set: { stageId: stage._id } });
    const historicalFilter = { trainerId, clientId, stageId: null, createdAt: { $gte: group.start, ...(group.end === Infinity ? {} : { $lte: new Date(group.end) }) } };
    await Promise.all([Note.updateMany(historicalFilter, { $set: { stageId: stage._id } }), Task.updateMany(historicalFilter, { $set: { stageId: stage._id } })]);
  }
  return { stages, relations };
}
async function resolveStage(trainerId, clientId, stageId, { onboarding = false, write = false } = {}) {
  const { stages, relations } = await ensureStages(trainerId, clientId);
  const allowed = onboarding ? LIVE_STATUSES : ["active"];
  if (!relations.some((r) => allowed.includes(r.status))) fail("No tienes una relación vigente con este cliente", 403, "NO_RELATION");
  const current = [...stages].reverse().find((s) => !s.endedAt);
  const stage = stageId ? stages.find((s) => String(s._id) === String(stageId)) : current;
  if (!stage) fail("Etapa no encontrada", 404, "STAGE_NOT_FOUND");
  if (write && String(stage._id) !== String(current?._id)) fail("El historial de etapas es de solo lectura", 409, "HISTORICAL_STAGE");
  return { stage, stages, current, relations };
}
function stageFilter(stage) {
  return { $or: [{ stageId: stage._id }, { stageId: null, createdAt: { $gte: stage.startedAt, ...(stage.endedAt ? { $lte: stage.endedAt } : {}) } }] };
}
async function recheckAccess(trainerId, clientId, stageId, onboarding = false, scope) {
  const query = { trainerId, clientId, stageId, status: { $in: onboarding ? LIVE_STATUSES : ["active"] }, ...(scope ? { scope } : {}) };
  if (!await Relation.exists(query)) fail("La relación cambió. Ya no puedes guardar información en esta etapa.", 403, "NO_RELATION");
}
module.exports = { ensureStages, resolveStage, stageFilter, recheckAccess };
