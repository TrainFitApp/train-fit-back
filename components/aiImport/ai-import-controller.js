const aiImportService = require("./ai-import-service");
const aiImportUtil = require("./ai-import-util");
const featureAccessService = require("../billing/feature-access-service");

module.exports = {
  async interpretExcel(req, res) {
    try {
      const { sheets, fileName } = req.body;

      if (!sheets || !Array.isArray(sheets) || sheets.length === 0) {
        return res.status(400).send({
          message: "Debes proporcionar al menos una hoja con datos",
        });
      }

      const result = await aiImportService.interpretExcel(sheets, fileName);
      return res.send(result);
    } catch (error) {
      console.error("[aiImport] interpretExcel error:", error.message);
      return res.status(500).send({
        message: error.message || "Error al interpretar el Excel",
      });
    }
  },

  async createTable(req, res) {
    try {
      const tableData = req.body;

      if (!tableData || !tableData.name || !tableData.splits) {
        return res.status(400).send({
          message: "Datos de tabla inválidos. Se requiere name y splits",
        });
      }

      const routineCount = Array.isArray(req.user?.ownTables)
        ? req.user.ownTables.length
        : 0;
      if (!featureAccessService.canCreateRoutine(req.user, routineCount)) {
        return res.status(403).send({
          code: "PREMIUM_LIMIT_ROUTINES",
          message: "Límite Free alcanzado. Solo puedes tener 1 rutina.",
        });
      }

      const createdTable = await aiImportUtil.createFullHierarchy(
        tableData,
        req.user.id
      );

      return res.send(createdTable);
    } catch (error) {
      console.error("[aiImport] createTable error:", error.message);
      return res.status(500).send({
        message: error.message || "Error al crear la tabla importada",
      });
    }
  },
};
