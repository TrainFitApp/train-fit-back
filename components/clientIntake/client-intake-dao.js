const ClientIntake = require("./client-intake-schema");

// El cliente envía lo que quiera en el body — nunca se confía el array tal
// cual (mismo criterio que el resto de este dao con goals/healthConditions/
// etc., aquí sin destructuring posible por ser un array de objetos).
function sanitizeCustomAnswers(customAnswers) {
  if (!Array.isArray(customAnswers)) return [];
  return customAnswers
    .filter((a) => a && typeof a.questionId === "string" && typeof a.label === "string")
    .map((a) => ({
      questionId: a.questionId,
      label: a.label.trim().slice(0, 200),
      value: typeof a.value === "string" ? a.value.trim().slice(0, 1000) : "",
    }));
}

module.exports = {
  async upsert(
    trainerId,
    clientId,
    { goals, healthConditions, experienceLevel, availability, equipment, customAnswers }
  ) {
    return ClientIntake.findOneAndUpdate(
      { trainerId, clientId },
      {
        $set: {
          goals: goals || "",
          healthConditions: healthConditions || "",
          experienceLevel: experienceLevel || null,
          availability: availability || "",
          equipment: equipment || "",
          customAnswers: sanitizeCustomAnswers(customAnswers),
          submittedAt: new Date(),
        },
      },
      { new: true, upsert: true }
    ).lean();
  },

  async getByTrainerAndClient(trainerId, clientId) {
    return ClientIntake.findOne({ trainerId, clientId }).lean();
  },
};
