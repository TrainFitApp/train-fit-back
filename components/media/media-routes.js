const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const controller = require("./media-controller");

const router = express.Router();
const ANY_ROLE = ["user", "admin", "trainer"];

router.getAsync("/status", auth(ANY_ROLE), controller.status);
router.postAsync("/consent", auth(ANY_ROLE), controller.consent);
router.postAsync("/uploads", auth(ANY_ROLE), controller.createUpload);
router.postAsync("/uploads/:id/complete", auth(ANY_ROLE), controller.completeUpload);
router.deleteAsync("/uploads/:id", auth(ANY_ROLE), controller.cancelUpload);

// Sin auth: Bunny no manda token. El servicio no se fía del cuerpo y vuelve
// a consultar el vídeo con la clave de la API.
router.postAsync("/webhooks/bunny", controller.bunnyWebhook);

// Almacenamiento local de desarrollo. El token firmado ES la autorización:
// un <img> o un <video> no pueden mandar la cabecera Authorization.
router.putAsync("/local/:token", controller.localPut);
router.getAsync("/local/:token", controller.localGet);

module.exports = router;
