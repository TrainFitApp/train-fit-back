const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const routes = require("./routes");
const { error404Handler, errorHandler } = require("./middleware");
const logger = require("./middleware/logger");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser()); // Parse cookies for refresh token

const cors = require("cors");
// Configuración CORS corregida
let serverDomain = process.env.SERVER_DOMAIN || null;
if (serverDomain && !serverDomain.startsWith("http")) {
  serverDomain = `https://${serverDomain}`;
}
const clientDomain = process.env.CLIENT_DOMAIN || null;
const allowedOrigins = [
  "capacitor://localhost", // iOS Capacitor (webview)
  "https://localhost", // iOS cuando iosScheme = 'https'
  "http://localhost", // Android Capacitor (webview)
  "http://localhost:8100", // Desarrollo local Ionic
  serverDomain, // Dominio del servidor (opcional)
  clientDomain, // Dominio de producción del cliente (opcional)
].filter(Boolean);

// Enable credentials for cookie support (refresh tokens)
const useCredentials = true;

const corsOptions = {
  origin: true, // Permitir todos los orígenes por ahora
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  credentials: useCredentials, // Enable cookies
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
// Responder explícitamente preflight OPTIONS para todas las rutas
app.options("*", cors(corsOptions));

app.set("trust proxy", 1);
app.use(logger);

app.use("/api", routes);

// Servir YouTube embed helper como archivo estático desde el servidor
app.get("/youtube-embed.html", (req, res) => {
  res.sendFile(path.join(__dirname, "youtube-embed.html"));
});

app.use(error404Handler);
app.use(errorHandler);

module.exports = app;
