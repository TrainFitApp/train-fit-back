const single = (resource) => ({
  _id: resource._id,
  trainerId: resource.trainerId,
  clientId: resource.clientId || null,
  clientEmail: resource.clientEmail,
  scope: resource.scope,
  status: resource.status,
  invitedAt: resource.invitedAt,
  respondedAt: resource.respondedAt,
  revokedAt: resource.revokedAt,
  revokedBy: resource.revokedBy,
});

const multiple = (resources) => resources.map(single);

// Para listInvitesByTrainer — clientId llega populado (name/lastname) desde
// findAllByTrainerWithClient; aquí se separa el id "de verdad" (string, lo
// que ya espera el resto del frontend) del nombre para mostrar, en vez de
// devolver el subdocumento entero como si fuera el id.
const singleWithClient = (resource) => {
  const populatedClient =
    resource.clientId && typeof resource.clientId === "object" ? resource.clientId : null;
  return {
    ...single(resource),
    clientId: populatedClient ? populatedClient._id : resource.clientId || null,
    client: populatedClient ? { name: populatedClient.name, lastname: populatedClient.lastname } : null,
  };
};

const multipleWithClient = (resources) => resources.map(singleWithClient);

// F04: como `single`, pero conserva `trainer` (nombre/apellidos/email) cuando
// el service lo adjuntó (ver trainer-client-service.js#attachTrainerInfo) —
// el cliente necesita saber QUIÉN le invitó, no solo el trainerId en bruto.
const singleWithTrainer = (resource) => ({
  ...single(resource),
  trainer: resource.trainer || null,
});

const multipleWithTrainer = (resources) => resources.map(singleWithTrainer);

// Para F05/F07: una entrada agregada por "otra parte" (cliente visto desde el
// profesional, o profesional visto desde el cliente), con sus scopes combinados.
const aggregated = (entry) => ({
  // Nota: sin foto de perfil todavía — professionalPhotoUrl es F25 (P1), no
  // aprobado en modelos-de-datos/05-cambios-modelos-existentes.md por ahora.
  user: entry.user
    ? {
        _id: entry.user._id,
        name: entry.user.name,
        lastname: entry.user.lastname,
        email: entry.user.email,
      }
    : null,
  scopes: entry.scopes,
});

const multipleAggregated = (entries) => entries.map(aggregated);

module.exports = {
  single,
  multiple,
  singleWithTrainer,
  multipleWithTrainer,
  singleWithClient,
  multipleWithClient,
  aggregated,
  multipleAggregated,
};
