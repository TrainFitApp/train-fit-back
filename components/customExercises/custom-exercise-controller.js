const customExerciseModel = require("./custom-exercise-model");
const tableAccess = require("../tables/table-access");
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
    const customExercise = await customExerciseModel.getCustomExerciseById(
      req.params.id
    );
    return res.send(customExercise);
  },

  async updateCustomExercise(req, res) {
    if (!(await assertCanAccessCustomExerciseId(req, res, req.body.customExercise?._id))) return;
    const customExercise = await customExerciseModel.updateCustomExercise(
      req.body.customExercise,
      req.body.setsToCreate,
      req.body.setsToUpdate,
      req.body.setsToDelete
    );

    return res.send(customExercise);
  },

  async addSetToCustomExercise(req, res) {
    if (!(await assertCanAccessCustomExerciseId(req, res, req.params.id))) return;
    const customExercise = await customExerciseModel.addSetToCustomExercise(
      req.params.id,
      req.body
    );

    return res.send(customExercise);
  },

  async copySetOnCustomExercise(req, res) {
    if (!(await assertCanAccessCustomExerciseId(req, res, req.body?._id))) return;
    const customExercise = await customExerciseModel.copySetOnCustomExercise(
      req.params.order,
      req.body
    );

    return res.send(customExercise);
  },

  // PUT /customexercises/:id/block — body: { blockId: string|null }
  async setCustomExerciseBlock(req, res) {
    if (!(await assertCanAccessCustomExerciseId(req, res, req.params.id))) return;
    try {
      const customExercise = await customExerciseModel.setCustomExerciseBlock(
        req.params.id,
        req.body?.blockId ?? null,
      );
      return res.send(customExercise);
    } catch (e) {
      if (e.code === "BLOCK_NOT_FOUND") return res.status(400).send({ message: e.message });
      if (e.code === "CUSTOM_EXERCISE_NOT_FOUND") return res.status(404).send({ message: e.message });
      throw e;
    }
  },

  async deleteCustomExercise(req, res) {
    if (!(await assertCanAccessCustomExerciseId(req, res, req.params.id))) return;
    await customExerciseModel.deleteCustomExercise(req.params.id);
    res.sendStatus(204);
  },

  async deleteCustomExercises(req, res) {
    const ids = Array.isArray(req.body) ? req.body : [];
    for (const idCustomExercise of ids) {
      if (!(await assertCanAccessCustomExerciseId(req, res, idCustomExercise))) return;
    }
    await customExerciseModel.deleteCustomExercises(req.body);
    res.sendStatus(204);
  },
};
