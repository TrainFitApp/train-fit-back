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

  async updateSet(req, res) {
    if (!(await assertCanAccessSetId(req, res, req.body?._id))) return;
    const set = await setModel.updateSet(req.body);
    return res.send(set);
  },

  async deleteById(req, res) {
    if (!(await assertCanAccessSetId(req, res, req.params.id))) return;
    await setModel.deleteSet(req.params.id);
    res.sendStatus(204);
  },
};
