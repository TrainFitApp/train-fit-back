const CoachProtocol = require("./coach-protocol-schema");

// Protocolos de un profesional (siempre filtrados por él).
module.exports = {
  create: (trainerId, data) => CoachProtocol.create({ trainerId, ...data }),
  listForTrainer: (trainerId) => CoachProtocol.find({ trainerId }).sort({ name: 1 }).lean(),
  findOwned: (trainerId, id) => CoachProtocol.findOne({ _id: id, trainerId }).lean(),
  update: (trainerId, id, updates) =>
    CoachProtocol.findOneAndUpdate({ _id: id, trainerId }, { $set: updates }, { new: true, runValidators: true }).lean(),
  remove: (trainerId, id) => CoachProtocol.findOneAndDelete({ _id: id, trainerId }),
};
