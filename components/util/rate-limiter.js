const rateLimitStore = new Map();

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 5;

function getClientIp(req) {
  return req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
    || req.connection?.remoteAddress
    || req.ip
    || "unknown";
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
