const trainerNoteDao = require("./trainer-note-dao");

// Notas privadas del profesional sobre su cliente (trainer-note-schema.js),
// siempre filtradas por los dos.

module.exports = {
  list: (trainerId, clientId) => trainerNoteDao.list(trainerId, clientId),
  create: (trainerId, clientId, text) => trainerNoteDao.create(trainerId, clientId, text),
  update: (trainerId, clientId, noteId, changes) => trainerNoteDao.update(trainerId, clientId, noteId, changes),
  remove: (trainerId, clientId, noteId) => trainerNoteDao.remove(trainerId, clientId, noteId),
};
