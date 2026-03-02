class Workout {
  constructor(data) {
    this.name = data.name;
    this.notes = data.notes;
    this.date = data.date;
    this.cronometer = data.cronometer;
    this.paused = data.paused;
    this.exercises = data.exercises;
  }

  //   static async create(data) {
  //     return new WorkoutModel(data).save();
  //   }

  //   static async getById(id) {
  //     return WorkoutModel.findById(id).populate("exercises");
  //   }
}

module.exports = Workout;
