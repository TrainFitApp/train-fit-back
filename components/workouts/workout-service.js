const workoutDao = require("./workout-dao");

module.exports = {
  async getWorkouts(page, limit) {
    return workoutDao.getWorkouts(page, limit);
  },
  async getWorkoutById(id) {
    return workoutDao.getWorkoutById(id);
  },

  async getWorkoutByIdAndDate(id, date) {
    return workoutDao.getWorkoutByIdAndDate(id, date);
  },

  async pasteWorkout(workoutClipboard, workoutToPaste) {
    return workoutDao.pasteWorkout(workoutClipboard, workoutToPaste);
  },

  async duplicateWorkoutRow(idTable, idWorkout, nameSuffix) {
    return workoutDao.duplicateWorkoutRow(idTable, idWorkout, nameSuffix);
  },

  async reorderWorkoutRows(idTable, workoutIdsOrder) {
    return workoutDao.reorderWorkoutRows(idTable, workoutIdsOrder);
  },

  async createWorkout(workout) {
    return workoutDao.createWorkout(workout);
  },

  async addWorkoutsToSplits(idTable, workout) {
    return workoutDao.addWorkoutsToSplits(idTable, workout);
  },

  async addExerciseToWorkouts(workoutIds, exerciseId) {
    return workoutDao.addExerciseToWorkouts(workoutIds, exerciseId);
  },

  async addWorkoutExercise(idWorkout, idExercise) {
    return workoutDao.addWorkoutExercise(idWorkout, idExercise);
  },

  async addWorkoutsExercises(idTable, idExercise, workoutOrder) {
    return workoutDao.addWorkoutsExercises(idTable, idExercise, workoutOrder);
  },

  async modifyWorkout(workout) {
    return workoutDao.modifyWorkout(workout);
  },

  async finishWorkout(workoutId, userId, date) {
    return workoutDao.finishWorkout(workoutId, userId, date);
  },

  async skipWorkout(workoutId, userId, rest) {
    return workoutDao.skipWorkout(workoutId, userId, rest);
  },

  async updateWorkout(workout, customExercise) {
    return workoutDao.updateWorkout(workout, customExercise);
  },

  async addDataExerciseToWorkout(workoutId, dataExerciseData) {
    return workoutDao.addDataExerciseToWorkout(workoutId, dataExerciseData);
  },

  async updateWorkoutsOrder(idWorkout, idTable, indexReorderedCustomExercises) {
    return await workoutDao.updateWorkoutsOrder(
      idWorkout,
      idTable,
      indexReorderedCustomExercises,
    );
  },

  async updateCustomExercises(
    idTable,
    idWorkout,
    idCustomExercise,
    idExercise,
  ) {
    return await workoutDao.updateCustomExercises(
      idTable,
      idWorkout,
      idCustomExercise,
      idExercise,
    );
  },

  async updateWorkoutsName(idTable, idWorkout, workoutsName) {
    return workoutDao.updateWorkoutsName(idTable, idWorkout, workoutsName);
  },

  async deleteWorkout(id) {
    return workoutDao.deleteWorkout(id);
  },

  async deleteWorkouts(workouts) {
    return workoutDao.deleteWorkouts(workouts);
  },

  async deleteWorkoutExercise(idWorkout, idExercise) {
    return workoutDao.deleteWorkoutExercise(idWorkout, idExercise);
  },

  async pasteExercises(tableId, sourceWorkoutId, targetWorkoutId, exercises) {
    return workoutDao.pasteExercises(tableId, sourceWorkoutId, targetWorkoutId, exercises);
  },

  async deleteWorkoutCustomExercises(idWorkout) {
    return workoutDao.deleteWorkoutCustomExercises(idWorkout);
  },
};
