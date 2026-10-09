const exerciseDao = require("./exercise-dao");
const { toSearchPage } = require("./exercise-search-paging");

module.exports = {
  async getSearchExercise(page, limit, searchExercisesFilterGroup) {
    return exerciseDao.getSearchExercise(
      page,
      limit,
      searchExercisesFilterGroup,
    );
  },

  async searchExercisePage(page, limit, searchExercisesFilterGroup) {
    const { items, total } = await exerciseDao.searchExercisePage(
      page,
      limit,
      searchExercisesFilterGroup,
    );
    return toSearchPage(items, total, page, limit);
  },

  async getExercise(id) {
    return exerciseDao.getExercise(id);
  },

  async countByUserId(userId) {
    return exerciseDao.countByUserId(userId);
  },

  async createExercise(exercise) {
    return exerciseDao.createExercise(exercise);
  },

  async updateExercise(id, exercise) {
    return exerciseDao.updateExercise(id, exercise);
  },

  async deleteExercise(id) {
    return exerciseDao.deleteExercise(id);
  },

  async getExerciseUsage(id) {
    const [customExerciseCount, workoutTemplateCount] = await Promise.all([
      exerciseDao.countCustomExerciseUsage(id),
      exerciseDao.countWorkoutTemplateUsage(id),
    ]);
    return { customExerciseCount, workoutTemplateCount };
  },
};
