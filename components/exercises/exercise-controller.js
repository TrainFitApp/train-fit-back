const exerciseModel = require("./exercise-model");
const exerciseDTO = require("./exercise-dto");

module.exports = {
  async getExercises(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const exercises = await exerciseModel.getExercises(page, limit);
    return res.send(exercises);
  },

  async getExerciseByCode(req, res) {
    const exercise = await exerciseModel.getExerciseByCode(req.params.barcode);
    return res.send(exercise);
  },

  async getSearchExercise(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const exercises = await exerciseModel.getSearchExercise(
      page,
      limit,
      req.body
    );
    return res.send(exercises);
  },

  async createExercise(req, res) {
    const exercise = await exerciseModel.createExercise(req.body);
    return res.send(exercise);
    // return res.send(exerciseDTO.single(exercise, req.body));
  },

  async updateExercise(req, res) {
    const exercise = await exerciseModel.getExercise(req.params.id);
    if (!exercise) return res.sendStatus(404);

    await exerciseModel.updateExercise(req.params.id, req.body);

    return res.sendStatus(204);
  },

  async archiveExercise(req, res) {
    await exerciseModel.archiveExercise(req.body.idExercise, req.body.idUser);
    return res.sendStatus(204);
  },

  async addExerciseToFavorites(req, res) {
    await exerciseModel.archiveExercise(req.body.idExercise, req.body.idUser);
    return res.sendStatus(204);
  },

  async deleteExercise(req, res) {
    const exercise = await exerciseModel.getExercise(req.params.id);
    if (!exercise) return res.sendStatus(404);

    const isAdmin = req.userData && req.userData.roles && req.userData.roles.includes("admin");
    const isOwner = exercise.userId && exercise.userId.toString() === req.user.id;

    if (!isAdmin && !isOwner) {
      return res.status(403).send({ message: "No tienes permiso para borrar este ejercicio." });
    }

    await exerciseModel.deleteExercise(req.params.id);
    return res.sendStatus(204);
  },
};
