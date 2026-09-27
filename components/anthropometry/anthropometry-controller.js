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
    const anthropometry = await anthropometryModel.getAnthropometryById(req.params.id, { ownOnly: true });
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
    const anthropometry = await anthropometryModel.updateAnthropometry(req.params.id, pickMeasurements(req.body));
    if (!anthropometry) return res.sendStatus(404);
    return res.send(anthropometry);
  },

  async deleteAnthropometry(req, res) {
    await anthropometryModel.deleteAnthropometry(req.params.id);
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

module.exports = controller;
