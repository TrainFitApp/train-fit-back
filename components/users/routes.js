const express = require("@awaitjs/express");
const controller = require("./controller");
const { auth } = require("../../middleware/validateAuth");

const router = express.Router();

function legacyAuthGone(req, res) {
  console.warn("[AUTH] legacy_users_auth_endpoint_used", {
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
    userAgent: req.headers?.["user-agent"],
  });

  return res.status(410).send({
    message: "Auth endpoint moved to /api/auth",
    code: "AUTH_ENDPOINT_GONE",
  });
}

router.getAsync("/", auth(["admin", "user"]), controller.countUsers);
// Público: comprobar si existe un email sin requerir auth
router.getAsync("/check/:email", controller.checkEmail);
router.getAsync("/:email", auth(["admin", "user"]), controller.getUserByEmail);
router.postAsync("/refresh-token", legacyAuthGone);
router.postAsync("/logout", legacyAuthGone);
router.postAsync("/auth/verify-google", legacyAuthGone);
router.postAsync("/auth/verify-apple", legacyAuthGone);
router.getAsync(
  "/auth/pass/:email/:password",
  legacyAuthGone,
);
router.postAsync("/", controller.createUser);
router.postAsync("/social", legacyAuthGone);
// router.postAsync("/google", controller.createSocialUser); // Mantener por compatibilidad si es necesario, o eliminar
// router.postAsync("/apple", controller.createSocialUser); // Unificando también Apple si es posible, o mantener separado si lógica difiere mucho
router.postAsync("/search", auth(["admin", "user"]), controller.searchUsers);
router.postAsync("/sign-in", legacyAuthGone);
router.postAsync(
  "/suggestions",
  auth(["admin", "user"]),
  controller.sendSuggestions,
);
router.postAsync("/impersonate", legacyAuthGone);
// Removed duplicate logout route - using the one at line 12 without auth
router.postAsync(
  "/search/by",
  auth(["admin", "user"]),
  controller.searchArchivedsByFilter,
);
router.getAsync("/hash/:id/:hash", controller.checkHash);
router.deleteAsync("/hash/:id", auth(["admin", "user"]), controller.clearUserHash);
router.getAsync("/send/mail/code/:email", controller.sendMailCode);
router.postAsync("/send/mail/code", controller.checkRestoreCode);
router.postAsync("/activate", legacyAuthGone);
router.putAsync(
  "/adddiet/:idUser/:idDiet",
  auth(["admin", "user"]),
  controller.addUserDiet,
);
router.putAsync(
  "/addtable/:idUser/:idTable",
  auth(["admin", "user"]),
  controller.addUserTable,
);
router.putAsync(
  "/playstopdiet/:idUser/:idDietInUse",
  auth(["admin", "user"]),
  controller.playStopDiet,
);
router.patchAsync(
  "/playstopdiet/:idUser",
  auth(["admin", "user"]),
  controller.playStopDiet,
);
router.putAsync("/", auth(["admin", "user"]), controller.updateUser);
router.putAsync("/social/update", legacyAuthGone);
// router.putAsync("/google/update", controller.updateSocialUser); // Compatibilidad
// router.putAsync("/apple/update", controller.updateSocialUser); // Compatibilidad
router.putAsync(
  "/favProduct",
  auth(["admin", "user"]),
  controller.addFavoriteProduct,
);
router.putAsync(
  "/favRecipe",
  auth(["admin", "user"]),
  controller.addFavoriteRecipe,
);
router.putAsync("/restore", legacyAuthGone);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteUser);

module.exports = router;
