const customExerciseModel = require("./custom-exercise-model");
// const customExerciseDTO = require("./dto");

module.exports = {
  async getCustomExerciseById(req, res) {
    const customExercise = await customExerciseModel.getCustomExerciseById(
      req.params.id
    );
    return res.send(customExercise);
  },

  async updateCustomExercise(req, res) {
    const customExercise = await customExerciseModel.updateCustomExercise(
      req.body.customExercise,
      req.body.setsToCreate,
      req.body.setsToUpdate,
      req.body.setsToDelete
    );

    return res.send(customExercise);
  },

  async addSetToCustomExercise(req, res) {
    const customExercise = await customExerciseModel.addSetToCustomExercise(
      req.params.id,
      req.body
    );

    return res.send(customExercise);
  },

  async copySetOnCustomExercise(req, res) {
    const customExercise = await customExerciseModel.copySetOnCustomExercise(
      req.params.order,
      req.body
    );

    return res.send(customExercise);
  },

  async deleteCustomExercise(req, res) {
    await customExerciseModel.deleteCustomExercise(req.params.id);
    res.sendStatus(204);
  },

  async deleteCustomExercises(req, res) {
    await customExerciseModel.deleteCustomExercises(req.body);
    res.sendStatus(204);
  },
};
