const mongoose = require("mongoose");
const trainerClientSchema = require("../trainerClients/trainer-client-schema");
const workoutSchema = require("../workouts/workout-schema");
const CheckinResponse = require("../trainerCheckins/checkin-response-schema");
const anthropometrySchema = require("../anthropometry/anthropometry-schema");

// anthropometry-schema.js exporta el Schema en crudo (no un modelo
// compilado, a diferencia del resto) — mismo guard que anthropometry-dao.js
// para no recompilarlo dos veces.
const Anthropometry =
  mongoose.models.Anthropometry || mongoose.model("Anthropometry", anthropometrySchema);

// Agregador de solo lectura (funcionalidad 14) — sin schema propio, agrega
// TrainerClient/Workout(plantillas)/CheckinResponse/Anthropometry ya
// definidos. Sin datos simulados: cualquier sección sin funcionalidad real
// construida todavía (agenda/mensajería) queda fuera, no se rellena con
// contenido inventado.
module.exports = {
  async getDashboard(trainerId) {
    const trainerObjectId = new mongoose.Types.ObjectId(trainerId);

    const activeClientIds = await trainerClientSchema.distinct("clientId", {
      trainerId: trainerObjectId,
      status: "active",
      clientId: { $ne: null },
    });

    const [activeClientsCount, workoutTemplatesCount, checkinResponsesCount] = await Promise.all([
      Promise.resolve(activeClientIds.length),
      workoutSchema.countDocuments({ trainerId: trainerObjectId }),
      CheckinResponse.countDocuments({ trainerId: trainerObjectId }),
    ]);

    // Evolución de peso: agregación real de MongoDB sobre Anthropometry
    // filtrando por los clientes activos del trainer, en una sola consulta
    // — a diferencia de refactor-claude (una petición HTTP por cliente,
    // límite artificial de 5), sin límite de clientes.
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const sinceIso = since.toISOString().slice(0, 10);

    const weightEvolution = await Anthropometry.aggregate([
      {
        $match: {
          userId: { $in: activeClientIds },
          date: { $gte: sinceIso },
          weight: { $exists: true, $ne: null },
        },
      },
      { $sort: { date: 1 } },
      {
        $group: {
          _id: "$userId",
          entries: { $push: { date: "$date", weight: "$weight" } },
        },
      },
    ]);

    return {
      kpis: {
        activeClients: activeClientsCount,
        workoutTemplates: workoutTemplatesCount,
        checkinResponses: checkinResponsesCount,
      },
      weightEvolution: weightEvolution.map((entry) => ({
        clientId: entry._id,
        entries: entry.entries,
      })),
    };
  },
};
