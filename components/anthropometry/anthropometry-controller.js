const anthropometryModel = require("./anthropometry-service");
const { pickMeasurements } = require("./anthropometry-origin");

// Pantallas del cliente: solo ve (y edita) lo que apuntó él, nunca lo que
// respondió en check-ins de su entrenador (anthropometry-origin.js).
const controller = {
  async createAnthropometry(req, res) {
    const anthropometry = await anthropometryModel.createAnthropometry(
      req.user.id,
      req.body.date,
      pickMeasurements(req.body)
    );
    return res.send(anthropometry);
  },

  async getAnthropometryById(req, res) {
    const anthropometry = await anthropometryModel.getAnthropometryById(req.params.id, {
      ownOnly: true,
      ownerId: ownerFilter(req),
    });
    if (!anthropometry) return res.sendStatus(404);
    return res.send(anthropometry);
  },

  async getAnthropometryByUserIdAndDate(req, res) {
    const anthropometry = await anthropometryModel.getAnthropometryByUserIdAndDate(req.user.id, req.body.date, {
      ownOnly: true,
    });
    return res.send(anthropometry);
  },

  async getAnthropometriesByUserIdBetweenDates(req, res) {
    const anthropometries = await anthropometryModel.getAnthropometriesByUserIdBetweenDates(
      req.user.id,
      req.body.minDate,
      req.body.maxDate,
      { ownOnly: true }
    );
    return res.send(anthropometries);
  },

  async getAllAnthropometriesByUserId(req, res) {
    const anthropometries = await anthropometryModel.getAllAnthropometriesByUserId(req.user.id, { ownOnly: true });
    return res.send(anthropometries);
  },

  async updateAnthropometry(req, res) {
    const anthropometry = await anthropometryModel.updateAnthropometry(req.params.id, pickMeasurements(req.body), {
      ownerId: ownerFilter(req),
    });
    if (!anthropometry) return res.sendStatus(404);
    return res.send(anthropometry);
  },

  async deleteAnthropometry(req, res) {
    const deleted = await anthropometryModel.deleteAnthropometry(req.params.id, { ownerId: ownerFilter(req) });
    if (!deleted) return res.sendStatus(404);
    return res.sendStatus(204);
  },

  async upsertAnthropometry(req, res) {
    const anthropometry = await anthropometryModel.upsertAnthropometry(
      req.user.id,
      req.body.date,
      pickMeasurements(req.body)
    );
    return res.send(anthropometry);
  },
};

// Por id, solo las mediciones propias (el admin, cualquiera).
const ownerFilter = (req) => (req.auth?.roles?.includes("admin") ? null : req.user.id);

module.exports = controller;
