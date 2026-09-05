const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const routes = require("./routes");
const billingController = require("./components/billing/billing-controller");
const { error404Handler, errorHandler } = require("./middleware");
const logger = require("./middleware/logger");
const maintenanceCheck = require("./middleware/maintenance");
const app = express();

// La API sirve datos autenticados/por-usuario — nunca deben cachearse en el
// navegador. Express genera ETag por defecto en cada res.send(), y un GET
// con el mismo cuerpo (p. ej. /trainer/invites sin cambios) puede volver un
// 304 sin body; si el navegador no tiene ese recurso en su cache de disco
// (sesión nueva, cache limpiada, cabeceras Authorization distintas entre
// peticiones) la respuesta le llega vacía a la app sin lanzar ningún error
// de red. Desactivar el cacheo evita la clase entera de bug.
app.set("etag", false);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));
app.use(cookieParser()); // Parse cookies for refresh token

const cors = require("cors");
const allowedOrigins = [
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:8100",
  "http://localhost:8101",
];
const useCredentials = true;

// CORS_OPEN=1 (ver npm run serve:open) refleja CUALQUIER origen — para
// developeo local cuando la IP de turno (simulador/dispositivo fisico/otro
// puerto de livereload) no vale la pena mantener en el allowlist a mano.
// Nunca activo por defecto ("npm start"/"npm run serve" siguen con el
// allowlist normal) — esto es un modo explicito, no el comportamiento base.
const corsFullyOpen = process.env.CORS_OPEN === "1";
if (corsFullyOpen) {
  console.warn(
    "[CORS] CORS_OPEN=1 — cualquier origen aceptado. Modo dev, no usar en produccion."
  );
}

const corsOptions = {
  origin(origin, callback) {
    if (corsFullyOpen) return callback(null, true);
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // TEMPORAL: origen exacto que se esta rechazando (quitar en cuanto se
    // resuelva el problema del livereload en dispositivo fisico).
    console.error("[CORS] Rechazado origin:", JSON.stringify(origin));
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "x-client-platform",
    "x-client-family",
    "x-refresh-token",
    "x-device-label",
  ],
  credentials: useCredentials, // Enable cookies
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Responder explícitamente preflight OPTIONS para todas las rutas
app.options("*", cors(corsOptions));

app.set("trust proxy", 1);
app.use(logger);
app.use(maintenanceCheck);

// Compatibilidad: algunos paneles externos se configuran sin prefijo /api.
app.post("/billing/webhooks/revenuecat", billingController.revenueCatWebhook);
app.use("/api", routes);

// Servir YouTube embed helper como archivo estático desde el servidor
app.get("/youtube-embed.html", (req, res) => {
  res.sendFile(path.join(__dirname, "youtube-embed.html"));
});

app.use(error404Handler);
app.use(errorHandler);

module.exports = app;
