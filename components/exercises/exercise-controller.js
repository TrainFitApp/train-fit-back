const exerciseModel = require("./exercise-model");
const exerciseDTO = require("./exercise-dto");
const featureAccessService = require("../billing/feature-access-service");

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

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
      req.body,
    );
    return res.send(exercises);
  },

  async createExercise(req, res) {
    const ownExerciseCount = await exerciseModel.countByUserId(req.user.id);
    if (!featureAccessService.canCreateExercise(req.user, ownExerciseCount)) {
      return res.status(403).send({
        code: "PREMIUM_LIMIT_EXERCISES",
        message: "L\u00edmite Free alcanzado. Solo puedes crear 2 ejercicios propios.",
      });
    }

    const exercise = await exerciseModel.createExercise({
      ...req.body,
      userId: req.user.id,
    });
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
    if (!isAdmin(req) && req.body.idUser !== req.user.id) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }
    await exerciseModel.archiveExercise(req.body.idExercise, req.body.idUser);
    return res.sendStatus(204);
  },

  async addExerciseToFavorites(req, res) {
    if (!isAdmin(req) && req.body.idUser !== req.user.id) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }
    const result = await exerciseModel.archiveExercise(
      req.body.idExercise,
      req.body.idUser,
    );
    return res.send({
      isFavorite: !!result?.isFavorite,
      message: result?.isFavorite
        ? "Exercise added to favorites"
        : "Exercise removed from favorites",
    });
  },

  async deleteExercise(req, res) {
    const exercise = await exerciseModel.getExercise(req.params.id);
    if (!exercise) return res.sendStatus(404);

    const isAdmin =
      req.userData &&
      req.userData.roles &&
      req.userData.roles.includes("admin");
    const isOwner =
      exercise.userId && exercise.userId.toString() === req.user.id;

    if (!isAdmin && !isOwner) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para borrar este ejercicio." });
    }

    // Nota: las referencias desde CustomExercise (rutinas reales de
    // clientes) ya las limpia el hook pre('deleteOne') de exercise-schema.js
    // (cascada: borra los CustomExercise y los desengancha del Workout). Solo
    // WorkoutTemplate.blocks[].exercises[] queda sin ningún mecanismo de
    // limpieza — de ahí que el bloqueo se limite a ese caso.
    const usage = await exerciseModel.getExerciseUsage(req.params.id);
    if (usage.workoutTemplateCount > 0) {
      return res.status(409).send({
        code: "EXERCISE_IN_USE",
        message:
          "Este ejercicio está en uso en una o más plantillas de rutina y no se puede borrar. Quítalo de esas plantillas primero.",
        ...usage,
      });
    }

    await exerciseModel.deleteExercise(req.params.id);
    return res.sendStatus(204);
  },
};
