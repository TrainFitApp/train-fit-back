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

module.exports = { single, multiple, aggregated, multipleAggregated };
