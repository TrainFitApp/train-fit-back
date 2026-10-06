// Lo que sale por la red de una fase (diet-phase-schema.js).

const toPlain = (doc) => (doc && typeof doc.toObject === "function" ? doc.toObject() : doc);

// Para listas: sin menús (pueden ser grandes y nadie los pinta en una lista),
// con cuántos tiene cada versión del contenido. `state` ("scheduled" |
// "current" | "past", util/phase-chain.js) solo donde se conoce la cadena.
function summary(phase, state) {
  const doc = toPlain(phase);
  return {
    _id: doc._id,
    clientId: doc.clientId,
    trainerId: doc.trainerId,
    name: doc.name,
    sourceTemplateId: doc.sourceTemplateId,
    startDate: doc.startDate,
    endDate: doc.endDate,
    ...(state ? { state } : {}),
    target: doc.target || null,
    proteinPerKg: doc.proteinPerKg,
    fatPerKg: doc.fatPerKg,
    createdAt: doc.createdAt,
    contents: (doc.contents || []).map((content) => ({
      _id: content._id,
      startDate: content.startDate,
      menusCount: (content.menus || []).length,
    })),
  };
}

// Con los menús de cada versión (alimentos y recetas poblados): para abrir el
// constructor sobre el contenido de la fase.
function full(phase) {
  const doc = toPlain(phase);
  return { ...summary(doc), contents: doc.contents || [] };
}

module.exports = { summary, full };
