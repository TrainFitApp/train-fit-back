const clientNotesDao = require("./client-notes-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const {
  buildTrainingNotes,
  buildPainNotes,
  buildNutritionNotes,
  sortNotes,
  applyReadState,
  filterNotes,
  countUnseen,
  paginate,
} = require("./client-notes-builder");

// Solo se cargan las fuentes de los ámbitos que este entrenador tiene con el
// cliente: un entrenador de nutrición no llega ni a leer las rutinas.
async function loadNotes(trainerId, clientId) {
  const scopes = await trainerClientDao.findActiveScopes(trainerId, clientId);
  const [training, pain, nutrition, reads] = await Promise.all([
    scopes.includes("training") ? clientNotesDao.loadTrainingSources(clientId) : null,
    scopes.includes("training") ? clientNotesDao.loadPainEntries(clientId) : [],
    scopes.includes("nutrition") ? clientNotesDao.loadNutritionSources(clientId) : null,
    clientNotesDao.listReads(trainerId, clientId),
  ]);
  const notes = [
    ...(training ? buildTrainingNotes(training) : []),
    ...buildPainNotes(pain),
    ...(nutrition ? buildNutritionNotes(nutrition) : []),
  ];
  return { scopes, notes: applyReadState(sortNotes(notes), reads) };
}

module.exports = {
  async list(trainerId, clientId, { domain, seen, q, page, limit }) {
    const { scopes, notes } = await loadNotes(trainerId, clientId);
    const visible = filterNotes(notes, { scopes });
    return {
      scopes,
      unread: countUnseen(visible),
      ...paginate(filterNotes(visible, { scopes, domain, seen, q }), { page, limit }),
    };
  },

  async unreadCount(trainerId, clientId) {
    const { scopes, notes } = await loadNotes(trainerId, clientId);
    return countUnseen(filterNotes(notes, { scopes }));
  },

  // Las claves se validan contra las notas reales del cliente: no se puede
  // marcar una clave inventada ni una nota de otro cliente o de un ámbito
  // ajeno. Con `all`, se marcan las que coinciden con el filtro de la lista.
  async setSeen(trainerId, clientId, { keys, all, seen, domain, q }) {
    const { scopes, notes } = await loadNotes(trainerId, clientId);
    const visible = filterNotes(notes, { scopes });
    const wanted = new Set(keys || []);
    const targets = all
      ? filterNotes(visible, { scopes, domain, q, seen: !seen })
      : visible.filter((note) => wanted.has(note.key));
    if (seen) await clientNotesDao.markSeen(trainerId, clientId, targets);
    else await clientNotesDao.markUnseen(trainerId, clientId, targets.map((note) => note.key));
    const changed = new Set(targets.map((note) => note.key));
    const after = visible.map((note) => (changed.has(note.key) ? { ...note, seen } : note));
    return { updated: targets.length, unread: countUnseen(after) };
  },
};
