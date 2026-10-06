const mongoose = require("mongoose");

// Un reciente oculto vuelve a salir si se añade otra vez después de
// ocultarlo. Cuándo se añadió lo delata el _id del CustomProduct/CustomRecipe
// (un ObjectId lleva su hora de creación). La fecha del día no sirve: se
// pueden planificar días futuros o copiar días antiguos.
//
// Primer ObjectId posible del segundo siguiente a la ocultación: con $lt
// quedan ocultos todos los creados hasta ese segundo incluido.
function cutoffId(hiddenAt) {
  const seconds = Math.floor(new Date(hiddenAt).getTime() / 1000) + 1;
  return mongoose.Types.ObjectId.createFromTime(seconds);
}

// Etapas de agregación que quitan los recientes ocultos. Devuelve un array
// (vacío si no hay nada oculto) para poder esparcirlo en el pipeline.
// refField = campo con el id del Product/Recipe; entryIdField = _id de la
// entrada de la comida (CustomProduct/CustomRecipe).
function buildHiddenRecentStages(hidden, { refField, entryIdField }) {
  if (!Array.isArray(hidden) || hidden.length === 0) return [];
  const clauses = hidden.map((entry) => ({
    ...(entry.refId ? { [refField]: entry.refId } : {}),
    [entryIdField]: { $lt: cutoffId(entry.hiddenAt) },
  }));
  return [{ $match: { $nor: clauses } }];
}

module.exports = { buildHiddenRecentStages };
