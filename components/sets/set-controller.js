const setModel = require("./set-service");
const tableAccess = require("../tables/table-access");

// Replanteamiento MVP (rutinas) — igual que en workout/customExercise, se
// cierra el hueco de propiedad al abrir el módulo a "trainer". createSet/
// createSets quedan sin comprobación: crean un documento Set aislado, sin
// dueño hasta que se adjunta a un CustomExercise vía
// addSetToCustomExercise (ya protegido en custom-exercise-controller.js).
async function assertCanAccessSetId(req, res, idSet) {
  const table = await tableAccess.findTableOwningSet(idSet);
  if (!table) {
    res.status(404).send({ message: "Serie no encontrada" });
    return null;
  }
  if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
    res.status(403).send({ message: "No tienes permiso para esta serie" });
    return null;
  }
  return table;
}

// Lo prescrito de una serie. En una rutina asignada, el cliente no lo
// reescribe: se descarta del payload (no se bloquea la petición, porque el
// front manda la serie completa también al registrar lo ejecutado).
const PRESCRIBED_SET_FIELDS = [
  "expectedReps",
  "expectedRir",
  "expectedTime",
  "expectedDistance",
  "expectedMin",
  "expectedSec",
];

function stripPrescribedFieldsForAssignedOwner(req, table, body) {
  const isAssignedOwner = Boolean(table?.assignedByTrainerId)
    && !tableAccess.isAdmin(req)
    && String(req.user?.id) === String(table.userId);
  if (!isAssignedOwner) return body;
  const clean = { ...body };
  for (const key of PRESCRIBED_SET_FIELDS) delete clean[key];
  return clean;
}

module.exports = {
  // NOTA: setModel.getSetById no existe (ni en set-service.js ni en
  // set-dao.js) — este endpoint ya fallaba con 500 antes de este cambio,
  // preexistente y fuera de alcance. La comprobación de propiedad se añade
  // igualmente por consistencia con el resto del módulo.
  async getSetById(req, res) {
    if (!(await assertCanAccessSetId(req, res, req.params.id))) return;
    const set = await setModel.getSetById(req.params.id);
    return res.send(set);
  },

  async createSet(req, res) {
    const set = await setModel.createSet(req.body);
    return res.send(set);
  },
  async createSets(req, res) {
    const sets = await setModel.createSets(req.body);
    return res.send(sets);
  },

  // 2026-09 — SIN rejectIfAssignedTableLockedForOwner a propósito, a
  // diferencia del resto de módulos de esta cadena. `setService.updateSet`
  // es como el cliente registra lo que REALMENTE hizo (reps/peso reales,
  // doned) durante su propia sesión, no como se edita lo pautado (eso pasa
  // por custom-exercise-controller.js#updateCustomExercise, sí protegido).
  // Un cliente con rutina asignada tiene que poder seguir entrenándola —
  // bloquear esto le impedía marcar series como hechas. Mismo criterio que
  // ya usa Nutrición: "consumido" nunca pasa por assertMealEditable.
  //
  // 2026-09 bis — se intentó primero un bloqueo CONDICIONAL aquí (solo si el
  // payload tocaba campos de pauta como expectedReps/expectedRir), para
  // cerrar el hueco real de custom-exercise.component.ts#configSet (ver
  // abajo). Descartado: `this.set` en el frontend es el documento COMPLETO,
  // así que el payload de un guardado normal de logging YA trae esas claves
  // presentes (con su valor sin tocar) — un `hasOwnProperty` las habría
  // pillado también, bloqueando marcar series hechas en rutinas asignadas.
  // El fix real va en el frontend: configSet ya no pasa por aquí.
  //
  // 2026-10 — en vez de bloquear, se DESCARTAN los campos prescritos cuando
  // quien escribe es el dueño de una rutina asignada: el guardado de logging
  // sigue funcionando y lo pautado no cambia.
  async updateSet(req, res) {
    const table = await assertCanAccessSetId(req, res, req.body?._id);
    if (!table) return;
    const set = await setModel.updateSet(stripPrescribedFieldsForAssignedOwner(req, table, req.body));
    return res.send(set);
  },

  // 2026-09 bis — a diferencia de updateSet, SIEMPRE bloqueado en rutina
  // asignada: borrar una serie entera no es "registrar lo que hice", es
  // mutar la pauta de forma permanente (el Set es el documento prescrito,
  // no un registro de sesión aparte) — no hay guardado de logging legítimo
  // que necesite borrar la serie completa, solo marcarla no hecha.
  async deleteById(req, res) {
    const table = await assertCanAccessSetId(req, res, req.params.id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    await setModel.deleteSet(req.params.id);
    res.sendStatus(204);
  },
};
