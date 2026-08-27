const ExerciseScore = require("./exercise-score-schema");

module.exports = {
  // Con el NOMBRE del ejercicio: la lista del entrenador es de ejercicios,
  // no de identificadores, y sin poblarlo la pantalla tendría que pedir el
  // catálogo entero para traducir 200 ids.
  //
  // `name` y nada más: el ejercicio trae vídeo, descripción de 6500
  // caracteres y varios arrays, y aquí no hace falta ninguno.
  async listForTrainer(trainerId) {
    return ExerciseScore.find({ trainerId })
      .populate("exerciseId", "name")
      .sort({ updatedAt: -1 })
      .lean();
  },

  // Las puntuaciones de unos ejercicios concretos. Es lo que necesita el
  // panel del planificador: los de la sesión abierta, no los 200 del
  // catálogo.
  async listForExercises(trainerId, exerciseIds) {
    if (!exerciseIds?.length) return [];
    return ExerciseScore.find({ trainerId, exerciseId: { $in: exerciseIds } }).lean();
  },

  async upsert(trainerId, exerciseId, data) {
    return ExerciseScore.findOneAndUpdate(
      { trainerId, exerciseId },
      { $set: data },
      { new: true, upsert: true }
    ).lean();
  },

  async remove(trainerId, exerciseId) {
    return ExerciseScore.deleteOne({ trainerId, exerciseId });
  },

  /**
   * Movimiento 6 Coach Pro — carga MASIVA.
   *
   * Puntuar 200 ejercicios de uno en uno es lo que hace que nadie lo haga
   * nunca. Un bulkWrite con upsert deja subirlos de golpe (desde una hoja
   * de cálculo, que es donde el entrenador ya los tiene) sin abrir 200
   * peticiones.
   *
   * `ordered: false` a propósito: si una fila falla, las demás se escriben
   * igual. Cargar 200 y perderlas todas por un id mal escrito sería el peor
   * resultado posible de esta operación.
   */
  async bulkUpsert(trainerId, entries) {
    if (!entries?.length) return { upserted: 0, modified: 0 };

    const operations = entries.map((entry) => ({
      updateOne: {
        filter: { trainerId, exerciseId: entry.exerciseId },
        update: {
          $set: {
            muscleScores: entry.muscleScores,
            jointScores: entry.jointScores,
            secondsPerSet: entry.secondsPerSet,
          },
        },
        upsert: true,
      },
    }));

    const result = await ExerciseScore.bulkWrite(operations, { ordered: false });
    return {
      upserted: result.upsertedCount || 0,
      modified: result.modifiedCount || 0,
    };
  },
};
