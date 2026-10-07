const express = require("express");
const cookieParser = require("cookie-parser");
const routes = require("./routes");
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

// Stripe firma los bytes originales. Este destino también funciona durante mantenimiento.
app.post("/api/billing/webhooks/stripe", express.raw({ type: "application/json", limit: "1mb" }),
  require("./components/trainerBilling/adapter").controller.webhook);
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: false, limit: "50mb" }));
app.use(cookieParser()); // Parse cookies for refresh token

const cors = require("cors");
const { isOriginAllowed } = require("./components/util/cors-origin");

const useCredentials = true;

// Los permisos anchos de CORS se piden explícitamente al arrancar: los
// scripts de desarrollo ponen NODE_ENV=development (ver package.json) y el
// servidor arranca `./bin/www` a secas, así que en producción no hay nada
// que desactivar ni recordar (ver cors-origin.js).
const isDevelopment = process.env.NODE_ENV === "development";

// CORS_OPEN=1 (ver npm run serve:open) refleja CUALQUIER origen, localhost o
// no — es para cuando el origen es una IP de la red local (simulador o
// dispositivo físico con livereload). Para otro puerto de `ionic serve` ya no
// hace falta: cualquier puerto local vale con `npm run serve`.
const corsFullyOpen = process.env.CORS_OPEN === "1";
if (corsFullyOpen && isDevelopment) {
  console.warn("[CORS] CORS_OPEN=1 — cualquier origen aceptado. Modo dev, no usar en produccion.");
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin, { isDevelopment, fullyOpen: corsFullyOpen })) {
      return callback(null, true);
    }
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
    "x-timezone",
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

app.use("/api", routes);

app.use(error404Handler);
app.use(errorHandler);

module.exports = app;
