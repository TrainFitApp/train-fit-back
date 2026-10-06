const customExerciseService = require("./custom-exercise-service");
const tableAccess = require("../tables/table-access");
const { withPinnedNotesSync } = require("../pinnedExerciseNotes/pinned-exercise-note-anchor-sync");
// const customExerciseDTO = require("./dto");

// Replanteamiento MVP (rutinas) — este módulo no comprobaba propiedad en
// ningún endpoint. Se cierra al abrir el módulo a "trainer" (mismo criterio
// que workout-controller.js/split-controller.js).
async function assertCanAccessCustomExerciseId(req, res, idCustomExercise) {
  const table = await tableAccess.findTableOwningCustomExercise(idCustomExercise);
  if (!table) {
    res.status(404).send({ message: "Ejercicio no encontrado" });
    return null;
  }
  if (!(await tableAccess.canAccessUserTable(req, table.userId))) {
    res.status(403).send({ message: "No tienes permiso para este ejercicio" });
    return null;
  }
  return table;
}

module.exports = {
  async getCustomExerciseById(req, res) {
    if (!(await assertCanAccessCustomExerciseId(req, res, req.params.id))) return;
    const customExercise = await customExerciseService.getCustomExerciseById(
      req.params.id
    );
    return res.send(customExercise);
  },

  async updateCustomExercise(req, res) {
    const table = await assertCanAccessCustomExerciseId(req, res, req.body.customExercise?._id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const customExercise = await customExerciseService.updateCustomExercise(
      req.body.customExercise,
      req.body.setsToCreate,
      req.body.setsToUpdate,
      req.body.setsToDelete
    );

    return res.send(customExercise);
  },

  async addSetToCustomExercise(req, res) {
    const table = await assertCanAccessCustomExerciseId(req, res, req.params.id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const customExercise = await customExerciseService.addSetToCustomExercise(
      req.params.id,
      req.body
    );

    return res.send(customExercise);
  },

  async copySetOnCustomExercise(req, res) {
    const table = await assertCanAccessCustomExerciseId(req, res, req.body?._id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    const customExercise = await customExerciseService.copySetOnCustomExercise(
      req.params.order,
      req.body
    );

    return res.send(customExercise);
  },

  // PUT /customexercises/:id/block — body: { blockId: string|null }
  async setCustomExerciseBlock(req, res) {
    const table = await assertCanAccessCustomExerciseId(req, res, req.params.id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    return res.send(await customExerciseService.setCustomExerciseBlock(req.params.id, req.body?.blockId ?? null));
  },

  // PUT /customexercises/:id/client-notes — body: { clientNotes: string }
  // 2026-09 — bug real: current-workout.page.ts (custom-exercise.component
  // .ts) guardaba la nota del CLIENTE reutilizando updateCustomExercise
  // entero (mismo endpoint que la edición de sets), así que quedó bloqueada
  // sin querer junto con la edición real de la pauta. Vía propia, mínima
  // ($set/$unset de un solo campo), que NUNCA comprueba
  // rejectIfAssignedTableLockedForOwner — mismo criterio que "consumido" en
  // Nutrición: la nota del cliente es suya, no toca lo que pautó el
  // entrenador.
  async updateClientNotes(req, res) {
    if (!(await assertCanAccessCustomExerciseId(req, res, req.params.id))) return;
    const customExercise = await customExerciseService.updateClientNotes(
      req.params.id,
      req.body?.clientNotes
    );
    return res.send(customExercise);
  },

  async deleteCustomExercise(req, res) {
    const table = await assertCanAccessCustomExerciseId(req, res, req.params.id);
    if (!table) return;
    if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
    await withPinnedNotesSync(table._id, () =>
      customExerciseService.deleteCustomExercise(req.params.id),
    );
    res.sendStatus(204);
  },

  async deleteCustomExercises(req, res) {
    const ids = Array.isArray(req.body) ? req.body : [];
    const tableIds = [];
    for (const idCustomExercise of ids) {
      const table = await assertCanAccessCustomExerciseId(req, res, idCustomExercise);
      if (!table) return;
      if (tableAccess.rejectIfAssignedTableLockedForOwner(req, res, table)) return;
      tableIds.push(table._id);
    }
    await withPinnedNotesSync(tableIds, () => customExerciseService.deleteCustomExercises(req.body));
    res.sendStatus(204);
  },
};
