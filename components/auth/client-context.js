// Desde qué app y plataforma llega una petición de sesión (cabeceras
// X-Client-Family y X-Client-Platform). La familia es también la audiencia de
// los tokens y el nombre de la cookie del refresh en web.

const PLATFORMS = ["web", "ios", "android"];

function clientContextOf(req) {
  const platformHeader = String(req.headers?.["x-client-platform"] || "").trim().toLowerCase();
  const clientFamily = String(req.headers?.["x-client-family"] || "").trim() || "trainfit-front";
  const platform = PLATFORMS.includes(platformHeader) ? platformHeader : "unknown";
  return {
    platform,
    clientFamily,
    audience: clientFamily,
    isNativeClient: platform === "ios" || platform === "android",
  };
}

// Cada app solo deja entrar a su rol: un profesional en la app de clientes
// (o al revés) se corta en el login con un mensaje claro, en vez de crear la
// sesión y fallar a trozos. Roles inclusivos: una cuenta con los dos roles
// entra en las dos apps.
const ROLE_BY_FAMILY = {
  "trainfit-trainers": {
    role: "trainer",
    message: "Esta cuenta no es de un profesional. Inicia sesión en la app TrainFit para clientes.",
  },
  "trainfit-front": {
    role: "user",
    message: "Esta es una cuenta de profesional. Inicia sesión en TrainFit Trainers.",
  },
};

// Mensaje para el usuario si su cuenta no es de esta app; null si puede entrar.
function wrongAppMessage(user, clientContext) {
  const requirement = ROLE_BY_FAMILY[clientContext.clientFamily];
  if (!requirement || (user.roles || []).includes(requirement.role)) return null;
  return requirement.message;
}

module.exports = { clientContextOf, wrongAppMessage };
