const exerciseService = require("./exercise-service");
const featureAccess = require("../billing/feature-access");

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

module.exports = {
  async getSearchExercise(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const exercises = await exerciseService.getSearchExercise(
      page,
      limit,
      req.body,
    );
    return res.send(exercises);
  },

  async createExercise(req, res) {
    // El límite de "ejercicios propios" es de consumidor: lo decide
    // user.premium, que un profesional nunca tiene (su plan vive en
    // professionalPremium y limita clientes, no catálogo). Sin esta excepción
    // el entrenador quedaría capado a 2 ejercicios, y además de forma
    // incoherente con la vía del Planner, que no pasa por ningún límite.
    const isTrainer = Boolean(req.userData?.roles?.includes("trainer"));
    if (!isTrainer) {
      const ownExerciseCount = await exerciseService.countByUserId(req.user.id);
      if (!featureAccess.canCreateExercise(req.user, ownExerciseCount)) {
        return res.status(403).send({
          code: "PREMIUM_LIMIT_EXERCISES",
          message: "L\u00edmite Free alcanzado. Solo puedes crear 2 ejercicios propios.",
        });
      }
    }

    const exercise = await exerciseService.createExercise({
      ...req.body,
      userId: req.user.id,
    });
    return res.send(exercise);
    // return res.send(exerciseDTO.single(exercise, req.body));
  },

  async updateExercise(req, res) {
    const exercise = await exerciseService.getExercise(req.params.id);
    if (!exercise) return res.sendStatus(404);

    // Sin esta comprobación cualquier autenticado podía reescribir un
    // ejercicio del catálogo global (userId vacío) o el de otro usuario. El
    // único cliente real es config-exercise.page.ts#saveOwnExerciseOnly, que
    // ya solo se activa sobre ejercicios propios — mismo criterio que
    // deleteExercise.
    const isOwner =
      exercise.userId && exercise.userId.toString() === req.user.id;
    if (!isAdmin(req) && !isOwner) {
      return res
        .status(403)
        .send({ message: "No tienes permiso para editar este ejercicio." });
    }

    // userId no es editable: evita que un update reasigne el dueño (o adopte
    // un ejercicio global) colando el campo en el body.
    const { userId, ...updatableFields } = req.body || {};

    await exerciseService.updateExercise(req.params.id, updatableFields);

    return res.sendStatus(204);
  },

  async deleteExercise(req, res) {
    const exercise = await exerciseService.getExercise(req.params.id);
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

    // En uso en plantillas del entrenador: se le pide quitarlo de ellas antes
    // (decisión de producto: una plantilla con un ejercicio retirado no se
    // podría volver a buscar ni cambiar por sí misma). En rutinas reales no
    // bloquea: el ejercicio se retira sin tocar el historial de nadie (ver
    // exercise-dao.js#deleteExercise).
    const usage = await exerciseService.getExerciseUsage(req.params.id);
    if (usage.workoutTemplateCount > 0) {
      return res.status(409).send({
        code: "EXERCISE_IN_USE",
        message:
          "Este ejercicio está en uso en una o más plantillas de rutina y no se puede borrar. Quítalo de esas plantillas primero.",
        ...usage,
      });
    }

    await exerciseService.deleteExercise(req.params.id);
    return res.sendStatus(204);
  },
};
