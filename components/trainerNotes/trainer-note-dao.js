const TrainerNote = require("./trainer-note-schema");

module.exports = {
  async create(trainerId, clientId, text) {
    return TrainerNote.create({ trainerId, clientId, text });
  },

  async list(trainerId, clientId) {
    return TrainerNote.find({ trainerId, clientId })
      .sort({ pinned: -1, createdAt: -1 })
      .lean();
  },

  // Un solo update para fijar/desfijar y/o corregir el texto — son dos
  // cambios sobre la misma nota, no dos operaciones distintas. `text`/
  // `pinned` llegan `undefined` cuando esa parte del PATCH no toca ese campo.
  async update(trainerId, clientId, noteId, { text, pinned }) {
    const set = {};
    if (typeof text === "string") set.text = text.trim().slice(0, 2000);
    if (typeof pinned === "boolean") set.pinned = pinned;

    // Fijado exclusivo — la cabecera del cliente solo tiene sitio para UNA
    // nota fijada, así que fijar esta desfija cualquier otra que lo estuviera
    // (no hace falta desfijar nada al DESfijar la única que había).
    if (set.pinned) {
      await TrainerNote.updateMany(
        { trainerId, clientId, _id: { $ne: noteId } },
        { $set: { pinned: false } }
      );
    }

    return TrainerNote.findOneAndUpdate(
      { _id: noteId, trainerId, clientId },
      { $set: set },
      { new: true }
    ).lean();
  },

  async remove(trainerId, clientId, noteId) {
    return TrainerNote.findOneAndDelete({ _id: noteId, trainerId, clientId }).lean();
  },
};
