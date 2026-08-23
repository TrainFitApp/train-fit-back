const anthropometryModel = require("./anthropometry-service");
const anthropometryRequestDao = require("../anthropometryRequests/anthropometry-request-dao");

const controller = {
  async createAnthropometry(req, res) {
    const anthropometry = await anthropometryModel.createAnthropometry({
      userId: req.user.id,
      date: req.body.date,
      neck: req.body.neck,
      chest: req.body.chest,
      bicepsRelaxed: req.body.bicepsRelaxed,
      bicepsContracted: req.body.bicepsContracted,
      waist: req.body.waist,
      abdomen: req.body.abdomen,
      hip: req.body.hip,
      thighContracted: req.body.thighContracted,
      thighRelaxed: req.body.thighRelaxed,
      calf: req.body.calf,
      weight: req.body.weight,
    });
    await anthropometryRequestDao.markFulfilledForClient(req.user.id);
    return res.send(anthropometry);
  },

  async getAnthropometryById(req, res) {
    const anthropometry = await anthropometryModel.getAnthropometryById(req.params.id);
    if (!anthropometry) return res.sendStatus(404);
    return res.send(anthropometry);
  },

  async getAnthropometryByUserIdAndDate(req, res) {
    const anthropometry = await anthropometryModel.getAnthropometryByUserIdAndDate(
      req.user.id,
      req.body.date
    );
    return res.send(anthropometry);
  },

  async getAnthropometriesByUserIdBetweenDates(req, res) {
    const anthropometries = await anthropometryModel.getAnthropometriesByUserIdBetweenDates(
      req.user.id,
      req.body.minDate,
      req.body.maxDate
    );
    return res.send(anthropometries);
  },

  async getAllAnthropometriesByUserId(req, res) {
    const anthropometries = await anthropometryModel.getAllAnthropometriesByUserId(req.user.id);
    return res.send(anthropometries);
  },

  async updateAnthropometry(req, res) {
    const anthropometry = await anthropometryModel.updateAnthropometry(req.params.id, {
      neck: req.body.neck,
      chest: req.body.chest,
      bicepsRelaxed: req.body.bicepsRelaxed,
      bicepsContracted: req.body.bicepsContracted,
      waist: req.body.waist,
      abdomen: req.body.abdomen,
      hip: req.body.hip,
      thighContracted: req.body.thighContracted,
      thighRelaxed: req.body.thighRelaxed,
      calf: req.body.calf,
      weight: req.body.weight,
    });
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
      {
        neck: req.body.neck,
        chest: req.body.chest,
        bicepsRelaxed: req.body.bicepsRelaxed,
        bicepsContracted: req.body.bicepsContracted,
        waist: req.body.waist,
        abdomen: req.body.abdomen,
        hip: req.body.hip,
        thighContracted: req.body.thighContracted,
        thighRelaxed: req.body.thighRelaxed,
        calf: req.body.calf,
        weight: req.body.weight,
      }
    );
    await anthropometryRequestDao.markFulfilledForClient(req.user.id);
    return res.send(anthropometry);
  },
};

module.exports = controller;