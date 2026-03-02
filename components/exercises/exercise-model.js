const exerciseDao = require("./exercise-dao");

module.exports = {
  async getExercises(page, limit) {
    return exerciseDao.getExercises(page, limit);
  },

  async getExerciseByCode(barcode) {
    return exerciseDao.getExerciseByCode(barcode);
  },

  async getSearchExercise(page, limit, searchExercisesFilterGroup) {
    return exerciseDao.getSearchExercise(
      page,
      limit,
      searchExercisesFilterGroup
    );
  },

  async getExercise(id) {
    return exerciseDao.getExercise(id);
  },

  async createExercise(exercise) {
    return exerciseDao.createExercise(exercise);
  },

  async updateExercise(id, exercise) {
    return exerciseDao.updateExercise(id, exercise);
  },
  async archiveExercise(idExercise, idUser) {
    return exerciseDao.archiveExercise(idExercise, idUser);
  },
};
