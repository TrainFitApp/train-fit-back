const workoutModel = require("./workout-service");

module.exports = {
  async getWorkouts(req, res) {
    const page = parseInt((req.query.page || 0).toString(), 10);
    const limit = parseInt((req.query.limit || 10).toString(), 10);
    const workouts = await workoutModel.getWorkouts(
      page,
      limit,
      req.params.search
    );
    return res.send(workouts);
  },

  async getWorkoutById(req, res) {
    const workout = await workoutModel.getWorkoutById(req.params.id);
    return res.send(workout);
  },

  async pasteWorkout(req, res) {
    const workout = await workoutModel.pasteWorkout(
      req.body.workoutClipboard,
      req.body.workoutToPaste
    );
    return res.send(workout);
  },

  async createWorkout(req, res) {
    const workout = await workoutModel.createWorkout({
      name: req.body.name,
      date: req.body.date,
      exercises: req.body.exercises,
    });
    return res.send(workout);
  },

  async addWorkoutsToSplits(req, res) {
    const table = await workoutModel.addWorkoutsToSplits(req.params.idTable, {
      name: req.body.name,
      date: req.body.date,
      exercises: req.body.exercises,
    });
    return res.send(table);
  },

  async getWorkoutByIdAndDate(req, res) {
    const workout = await workoutModel.getWorkoutByIdAndDate(
      req.params.id,
      req.body.date
    );
    return res.send(workout);
  },

  async createWorkout(req, res) {
    const workout = await workoutModel.createWorkout({
      name: req.body.name,
      date: req.body.date,
      exercises: req.body.exercises,
    });
    return res.send(workout);
  },

  async addWorkoutExercise(req, res) {
    const workout = await workoutModel.addWorkoutExercise(
      req.params.idWorkout,
      req.params.idExercise
    );
    return res.send(workout);
  },

  async addWorkoutsExercises(req, res) {
    const table = await workoutModel.addWorkoutsExercises(
      req.params.idTable,
      req.params.idExercise,
      req.params.workoutOrder
    );
    return res.send(table);
  },

  async modifyWorkout(req, res) {
    const workout = await workoutModel.modifyWorkout(req.body);
    return res.send(workout);
  },

  async updateWorkout(req, res) {
    const workout = await workoutModel.updateWorkout(
      req.body.workout,
      req.body.customExercise
    );
    return res.send(workout);
  },

  async addDataExerciseToWorkout(req, res) {
    const workout = await workoutModel.addDataExerciseToWorkout(
      req.params.idWorkout,
      req.body
    );
    return res.send(workout);
  },

  async updateWorkoutsOrder(req, res) {
    const workout = await workoutModel.updateWorkoutsOrder(
      req.params.idWorkout,
      req.params.idTable,
      req.body
    );
    return res.send(workout);
  },

  async updateCustomExercises(req, res) {
    const table = await workoutModel.updateCustomExercises(
      req.params.idTable,
      req.params.idWorkout,
      req.params.idCustomExercise,
      req.params.idExercise
    );
    return res.send(table);
  },

  async updateWorkoutsName(req, res) {
    await workoutModel.updateWorkoutsName(
      req.params.idTable,
      req.params.idWorkout,
      req.body.workoutsName
    );
    return res.sendStatus(204);
  },

  async deleteWorkouts(req, res) {
    await workoutModel.deleteWorkouts(req.body);
    res.sendStatus(204);
  },

  async deleteWorkout(req, res) {
    await workoutModel.deleteWorkout(req.param.id);
    res.sendStatus(204);
  },

  async deleteWorkoutExercise(req, res) {
    const workout = await workoutModel.deleteWorkoutExercise(
      req.params.idWorkout,
      req.params.idExercise
    );
    return res.send(workout);
  },

  async deleteWorkoutCustomExercises(req, res) {
    await workoutModel.deleteWorkoutCustomExercises(req.params.id);
    res.sendStatus(204);
  },
};
