// PURO. Filtro de ORIGEN del cajón "Empezar fase" → filtro Mongo de las
// plantillas (DietTemplate: solo biblioteca) rankeables para un cliente.
//
// Los tres orígenes son DISJUNTOS: una dieta de fábrica (verified) cae solo en
// 'verified', aunque la creara este mismo entrenador (admin) o cuelgue de este
// cliente. Si no, "Añadidas por mí" / "De este cliente" devolvían también las de
// TrainFit y el filtro no separaba nada. La unión de los tres no cambia.
const SOURCES = ["general", "client", "verified"];

// `sources` sin válidos (o ausente) = las tres, igual que "Todas" en el cajón.
function rankableFilter(trainerId, clientId, sources) {
  const valid = Array.isArray(sources) ? sources.filter((s) => SOURCES.includes(s)) : [];
  const set = new Set(valid.length ? valid : SOURCES);
  const notFactory = { verified: { $ne: true } };
  const or = [];
  if (set.has("general")) or.push({ trainerId, ownerClientId: null, ...notFactory });
  if (set.has("client")) or.push({ trainerId, ownerClientId: clientId, ...notFactory });
  if (set.has("verified")) or.push({ verified: true });
  return { $or: or };
}

// PURO. Filtro de LECTURA de UNA plantilla por id (vista previa): las mías y
// las de fábrica de cualquiera, las mismas que ya entran en el ranking de
// "Empezar fase". Solo para leer: editar, borrar y aplicar siguen exigiendo
// ser el dueño.
function readableFilter(trainerId, id) {
  return { _id: id, $or: [{ trainerId }, { verified: true }] };
}

module.exports = { SOURCES, rankableFilter, readableFilter };
