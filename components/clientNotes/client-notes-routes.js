const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { requireActiveClient } = require("../trainerClients/require-active-client");
const controller = require("./client-notes-controller");

const router = express.Router();

// Montadas bajo /trainer. En /client-notes y no en /notes: /clients/:clientId/notes
// ya son las notas privadas del entrenador (trainer-client-routes.js, montado
// antes). requireActiveClient SIN scope: cualquier ámbito activo da acceso, y
// el servicio ya recorta a las notas de los scopes de este entrenador.
//
// Marcar como vista se permite también con el cliente en solo lectura (por
// encima del cupo del plan): es un estado del entrenador, no toca ningún
// dato del cliente.
router.getAsync("/clients/:clientId/client-notes/unread-count", auth(["trainer"]), requireActiveClient(), controller.unreadCount);
router.getAsync("/clients/:clientId/client-notes", auth(["trainer"]), requireActiveClient(), controller.list);
router.putAsync(
  "/clients/:clientId/client-notes/seen",
  auth(["trainer"]),
  requireActiveClient(null, { allowReadOnly: true }),
  controller.setSeen
);

module.exports = router;
