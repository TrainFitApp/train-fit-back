const rateLimitStore = new Map();

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 5;

// req.ip ya resuelve la IP real detrás del proxy (app.js: trust proxy 1). El
// primer valor de x-forwarded-for lo pone el cliente: leerlo a mano dejaba
// saltarse el límite cambiando esa cabecera en cada petición.
function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || "unknown";
}

module.exports = function rateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();

  if (!rateLimitStore.has(ip)) {
    rateLimitStore.set(ip, []);
  }

  const timestamps = rateLimitStore.get(ip).filter(t => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_REQUESTS) {
    return res.status(429).send({ message: "Demasiadas solicitudes. Espera un momento." });
  }

  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);

  next();
};
