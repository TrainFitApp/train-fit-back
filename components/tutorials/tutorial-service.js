const tutorialSchema = require("./tutorial-schema");

module.exports = {
  async getAll() {
    return tutorialSchema.find({}).sort({ level: 1, order: 1 }).lean();
  },

  async getAllKeys() {
    return tutorialSchema.distinct("key");
  },

  // Usada al crear un usuario nuevo: si la BD de tutoriales está vacía o
  // inaccesible en ese instante, no debe romper el alta — simplemente arranca
  // sin tutoriales pendientes.
  async getAllKeysSafe() {
    try {
      return await tutorialSchema.distinct("key");
    } catch (error) {
      console.error("[Tutorials] No se pudieron cargar las keys iniciales", error);
      return [];
    }
  },
};
