const express = require("@awaitjs/express");
const controller = require("./controller");
const { auth, basicAuth } = require("../../middleware/validateAuth");

const router = express.Router();

router.getAsync("/", auth(["admin", "user"]), controller.countUsers);
// Público: comprobar si existe un email sin requerir auth
router.getAsync("/check/:email", controller.checkEmail);
router.getAsync("/:email", auth(["admin", "user"]), controller.getUserByEmail);
router.postAsync("/refresh-token", controller.refreshToken);
router.postAsync("/logout", controller.logout); // No auth required - called when token is invalid
router.postAsync("/auth/verify-google", controller.verifyGoogle);
router.postAsync("/auth/verify-apple", controller.verifyApple);
router.getAsync(
  "/auth/pass/:email/:password",
  auth(["admin", "user"]),
  controller.updatePassword,
);
router.postAsync("/", controller.createUser);
router.postAsync("/social", controller.createSocialUser);
// router.postAsync("/google", controller.createSocialUser); // Mantener por compatibilidad si es necesario, o eliminar
// router.postAsync("/apple", controller.createSocialUser); // Unificando también Apple si es posible, o mantener separado si lógica difiere mucho
router.postAsync("/search", auth(["admin", "user"]), controller.searchUsers);
router.postAsync("/sign-in", basicAuth, controller.login);
router.postAsync(
  "/suggestions",
  auth(["admin", "user"]),
  controller.sendSuggestions,
);
router.postAsync("/impersonate", auth(["admin"]), controller.impersonateUser);
// Removed duplicate logout route - using the one at line 12 without auth
router.postAsync(
  "/search/by",
  auth(["admin", "user"]),
  controller.searchArchivedsByFilter,
);
router.getAsync("/hash/:id/:hash", controller.checkHash);
router.deleteAsync("/hash/:id", auth(["admin", "user"]), controller.clearUserHash);
router.patchAsync("/premium/lifetime/:id", auth(["admin"]), controller.grantLifetimePremium);
router.deleteAsync("/premium/lifetime/:id", auth(["admin"]), controller.revokeLifetimePremium);
router.getAsync("/send/mail/code/:email", controller.sendMailCode);
router.postAsync("/send/mail/code", controller.checkRestoreCode);
router.postAsync("/activate", controller.activateAccount);
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
router.putAsync("/social/update", controller.updateSocialUser);
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
router.putAsync("/restore", controller.restorePassword);
router.deleteAsync("/:id", auth(["admin", "user"]), controller.deleteUser);

module.exports = router;
