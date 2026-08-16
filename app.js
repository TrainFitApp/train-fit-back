const express = require("express");
const path = require("path");
const cookieParser = require("cookie-parser");
const routes = require("./routes");
const billingController = require("./components/billing/billing-controller");
const { error404Handler, errorHandler } = require("./middleware");
const logger = require("./middleware/logger");
const maintenanceCheck = require("./middleware/maintenance");
const { startCheckinReminderCron } = require("./components/trainerCheckins/checkin-reminder-cron");
const app = express();

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
  // para probar
  "http://localhost:8101"
];
const useCredentials = true;

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
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

startCheckinReminderCron();

module.exports = app;
