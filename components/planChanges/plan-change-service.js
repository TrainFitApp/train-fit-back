const PlanChange = require("./plan-change-schema");

// Fase 4 Coach Pro — construir y guardar entradas del historial.
//
// La parte de COMPARAR (diffFields) es pura y está testeada: es donde vive
// el error silencioso de esta clase de código — registrar un cambio que no
// ocurrió, o perderse uno que sí.

// Campos de un objetivo nutricional que merecen historial, con su etiqueta.
// Se declara aquí y no se infiere del documento entero porque un objetivo
// trae también _id, userId, timestamps y campos de vigencia: "updatedAt ha
// cambiado" no es información para nadie.
const NUTRITIONAL_GOAL_FIELDS = [
  { field: "name", label: "Nombre" },
  { field: "kcalTotal", label: "Calorías" },
  { field: "proteinsGTotal", label: "Proteínas" },
  { field: "carbohydratesGTotal", label: "Carbohidratos" },
  { field: "fatGTotal", label: "Grasas" },
];

const PLAN_ASSIGNMENT_FIELDS = [
  { field: "startDate", label: "Inicio" },
  { field: "endDate", label: "Fin" },
];

// Activar una rutina no edita ningún valor (a diferencia de un objetivo
// nutricional) — el único "campo" que cambia de verdad es CUÁL rutina rige,
// así que se diffea por nombre, igual de simple que como ya se lee la fila
// en el historial de nutrición.
// Tarea 4 (2026-09) — startDate no vive en Table (vive en RoutineAssignment);
// el controller que llama a recordRoutineChange arma una vista fusionada
// {...table, startDate} antes de pasarla aquí. diffFields tolera campos
// ausentes en cualquiera de los dos lados, así que la llamada existente
// desde activateTable (sin startDate en ninguno) sigue funcionando igual.
const ROUTINE_FIELDS = [
  { field: "name", label: "Rutina" },
  { field: "startDate", label: "Inicio" },
];

/**
 * Diferencias entre dos versiones, solo de los campos declarados.
 *
 * Compara con != laxo tras normalizar a string para que 2100 y "2100" no se
 * registren como un cambio: los números llegan como string desde los
 * formularios del frontend y esa comparación estricta llenaría el historial
 * de cambios inexistentes.
 */
function diffFields(previous, next, fieldDefs) {
  const changes = [];
  for (const { field, label } of fieldDefs) {
    const before = previous ? previous[field] : null;
    const after = next ? next[field] : null;

    const normalizedBefore = before === null || before === undefined ? "" : String(before);
    const normalizedAfter = after === null || after === undefined ? "" : String(after);
    if (normalizedBefore === normalizedAfter) continue;

    changes.push({
      field,
      label,
      previousValue: before ?? null,
      newValue: after ?? null,
    });
  }
  return changes;
}

async function record({ trainerId, clientId, entity, entityId, entityName, action, changes, reason }) {
  // Un registro sin cambios ni motivo no cuenta nada: no se guarda. Ocurre
  // al "guardar" un formulario sin tocar nada, que es más frecuente de lo
  // que parece.
  if (!changes?.length && !reason) return null;

  return PlanChange.create({
    trainerId,
    clientId,
    entity,
    entityId: entityId || null,
    entityName: entityName || "",
    action,
    changes: changes || [],
    reason: reason || "",
  });
}

/** Cambio de objetivo nutricional: el caso del ejemplo (2200 -> 2100 kcal). */
async function recordGoalChange({ trainerId, clientId, previousGoal, newGoal, action, reason }) {
  return record({
    trainerId,
    clientId,
    entity: "nutritional_goal",
    entityId: newGoal?._id,
    entityName: newGoal?.name,
    action,
    changes: diffFields(previousGoal, newGoal, NUTRITIONAL_GOAL_FIELDS),
    reason,
  });
}

/** Cambio de rutina activa: cuál regía antes -> cuál rige ahora. */
async function recordRoutineChange({ trainerId, clientId, previousTable, newTable, reason }) {
  return record({
    trainerId,
    clientId,
    entity: "routine",
    entityId: newTable?._id,
    entityName: newTable?.name,
    action: previousTable ? "replaced" : "assigned",
    changes: diffFields(previousTable, newTable, ROUTINE_FIELDS),
    reason,
  });
}

async function recordPlanAssignment({ trainerId, clientId, previousAssignment, newAssignment, planName, reason }) {
  return record({
    trainerId,
    clientId,
    entity: "diet_plan",
    entityId: newAssignment?._id,
    entityName: planName,
    action: previousAssignment ? "replaced" : "assigned",
    changes: diffFields(previousAssignment, newAssignment, PLAN_ASSIGNMENT_FIELDS),
    reason,
  });
}

async function listForClient(trainerId, clientId, { entity, limit = 100 } = {}) {
  const filter = { trainerId, clientId };
  if (entity) filter.entity = entity;
  return PlanChange.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
}

module.exports = {
  NUTRITIONAL_GOAL_FIELDS,
  PLAN_ASSIGNMENT_FIELDS,
  ROUTINE_FIELDS,
  diffFields,
  record,
  recordGoalChange,
  recordRoutineChange,
  recordPlanAssignment,
  listForClient,
};
