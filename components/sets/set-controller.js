const setService = require("./set-service");
const tableAccess = require("../tables/table-access");

// Toda serie vive dentro de una sesión de una rutina: el permiso es el de
// esa rutina (mismo criterio que sesiones y ejercicios).
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

// Lo prescrito de una serie. En una rutina asignada (mientras dure la
// relación con quien la pautó), el cliente no lo reescribe: se descarta del
// payload (no se bloquea la petición, porque el front manda la serie
// completa también al registrar lo ejecutado).
const PRESCRIBED_SET_FIELDS = [
  "expectedReps",
  "expectedWeight",
  "expectedRir",
  "expectedTime",
  "expectedDistance",
  "drop",
  "restPause",
  "restSeconds",
];

async function stripPrescribedFieldsForAssignedOwner(req, table, body) {
  if (!(await tableAccess.isLockedForOwner(req, table))) return body;
  const clean = { ...body };
  for (const key of PRESCRIBED_SET_FIELDS) delete clean[key];
  return clean;
}

module.exports = {
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
    const set = await setService.updateSet(await stripPrescribedFieldsForAssignedOwner(req, table, req.body));
    if (!set) return res.status(404).send({ message: "Serie no encontrada" });
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
    if (await tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    await setService.deleteSet(req.params.id);
    res.sendStatus(204);
  },
};
