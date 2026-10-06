// PURO — lectura del documento de un par profesional ↔ cliente
// (trainer-client-schema.js). Sin BD: lo comparten el DAO, los servicios y
// los tests.

const SCOPES = ["training", "nutrition"];
const LINK_STATUSES = ["pending", "active", "declined", "revoked"];
// Invitación sin responder o relación en curso: como mucho una por scope y
// par, y es lo que reserva u ocupa plaza del profesional.
const OPEN_STATUSES = ["pending", "active"];

const linksOf = (pair) => pair?.scopes || [];
const isActive = (link, scope) => link.status === "active" && (!scope || link.scope === scope);

function hasActiveScope(pair, scope = null) {
  return linksOf(pair).some((link) => isActive(link, scope));
}

function activeScopes(pair) {
  return [...new Set(linksOf(pair).filter((link) => isActive(link)).map((link) => link.scope))];
}

function hasOpenLink(pair) {
  return linksOf(pair).some((link) => OPEN_STATUSES.includes(link.status));
}

function openLink(pair, scope) {
  return linksOf(pair).find((link) => link.scope === scope && OPEN_STATUSES.includes(link.status)) || null;
}

function findLink(pair, linkId) {
  return linksOf(pair).find((link) => String(link._id) === String(linkId)) || null;
}

// Desde cuándo dura la relación en curso: la aceptación más antigua de los
// scopes activos. Las fotos de progreso se ven desde ese día.
function activeSince(pair) {
  const times = linksOf(pair)
    .filter((link) => isActive(link))
    .map((link) => link.respondedAt || link.invitedAt)
    .filter(Boolean)
    .map((date) => new Date(date).getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

// Fin de la última relación anterior (cualquier scope). Las notas y tareas
// creadas antes son "de una relación anterior".
function latestRevokedAt(pair) {
  const times = linksOf(pair)
    .filter((link) => link.status === "revoked" && link.revokedAt)
    .map((link) => new Date(link.revokedAt).getTime());
  return times.length ? new Date(Math.max(...times)) : null;
}

// "active" si queda algún scope activo, "former" si solo quedan relaciones
// terminadas, null si nunca llegó a ser su cliente.
function relationState(pair) {
  if (hasActiveScope(pair)) return "active";
  return linksOf(pair).some((link) => link.status === "revoked") ? "former" : null;
}

// ¿Queda pendiente el cuestionario al aceptar un scope? Con el primer scope
// en curso, sí. Si ya había otro activo, se conserva lo que hubiera: enviado
// no se repite; sin enviar sigue pendiente (y al rellenarlo ya incluye los
// campos del scope nuevo).
function intakePendingOnAccept(pair) {
  return hasActiveScope(pair) ? Boolean(pair.intakePending) : true;
}

// Estado del cuestionario de alta visto por las dos partes:
//   "pending"   → aún no lo ha enviado;
//   "submitted" → enviado y sin revisar: el cliente puede editarlo o rehacerlo;
//   "reviewed"  → el profesional lo marcó revisado: solo lectura;
//   null        → relación sin cuestionario.
function intakeStatusOf(pair) {
  if (pair?.intakePending) return "pending";
  if (!pair?.intake?.submittedAt) return null;
  return pair.intake.reviewedAt ? "reviewed" : "submitted";
}

// Una invitación (entrada de scope) en plano, como la ven las apps.
function invitationView(pair, link) {
  return {
    _id: link._id,
    trainerId: pair.trainerId,
    clientId: pair.clientId || null,
    clientEmail: pair.clientEmail,
    scope: link.scope,
    status: link.status,
    invitedAt: link.invitedAt,
    respondedAt: link.respondedAt || null,
    revokedAt: link.revokedAt || null,
    revokedBy: link.revokedBy || null,
  };
}

// Todas las invitaciones de varios pares, de la más reciente a la más antigua.
function invitationsOf(pairs, filter = () => true) {
  return pairs
    .flatMap((pair) => linksOf(pair).filter(filter).map((link) => ({ pair, link })))
    .sort((a, b) => new Date(b.link.invitedAt) - new Date(a.link.invitedAt));
}

module.exports = {
  SCOPES,
  LINK_STATUSES,
  OPEN_STATUSES,
  hasActiveScope,
  activeScopes,
  hasOpenLink,
  openLink,
  findLink,
  activeSince,
  latestRevokedAt,
  relationState,
  intakePendingOnAccept,
  intakeStatusOf,
  invitationView,
  invitationsOf,
};
