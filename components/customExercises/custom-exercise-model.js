const customExerciseDao = require("./custom-exercise-dao");

module.exports = {
  async getCustomExerciseById(id) {
    return customExerciseDao.findCustomExerciseById(id);
  },

  async updateCustomExercise(
    customExercise,
    setsToCreate,
    setsToUpdate,
    setsToDelete
  ) {
    return customExerciseDao.updateCustomExercise(
      customExercise,
      setsToCreate,
      setsToUpdate,
      setsToDelete
    );
  },

  async addSetToCustomExercise(id, set) {
    return customExerciseDao.addSetToCustomExercise(id, set);
  },

  async copySetOnCustomExercise(order, customExdercise) {
    return customExerciseDao.copySetOnCustomExercise(order, customExdercise);
  },

  async setCustomExerciseBlock(id, blockId) {
    return customExerciseDao.setCustomExerciseBlock(id, blockId);
  },

  async deleteCustomExercise(id) {
    return customExerciseDao.deleteCustomExercise(id);
  },

  async deleteCustomExercises(ids) {
    return customExerciseDao.deleteCustomExercises(ids);
  },
};
