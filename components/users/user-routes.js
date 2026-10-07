const express = require("@awaitjs/express");
const controller = require("./user-controller");
const { auth } = require("../../middleware/validateAuth");
const rateLimiter = require("../util/rate-limiter");

const router = express.Router();

// Recuento, listado y búsqueda global de cuentas: solo admin (management).
router.getAsync("/", auth(["admin"]), controller.countUsers);
// Público: comprobar si existe un email sin requerir auth
router.getAsync("/check/:email", controller.checkEmail);
router.getAsync("/:email", auth(["admin", "user", "trainer"]), controller.getUserByEmail);
router.postAsync("/", controller.createUser);
router.postAsync("/professional", controller.createProfessionalUser);
router.postAsync("/search", auth(["admin"]), controller.searchUsers);
router.postAsync(
  "/suggestions",
  auth(["admin", "user"]),
  controller.sendSuggestions,
);
router.getAsync("/hash/:id/:hash", controller.checkHash);
// Activar a mano una cuenta (borrar su código pendiente): solo admin. Con
// "user", cualquiera activaba cuentas ajenas sin el código.
router.deleteAsync("/hash/:id", auth(["admin"]), controller.clearUserHash);
router.getAsync("/send/mail/code/:email", rateLimiter, controller.sendMailCode);
router.postAsync("/send/mail/code", controller.checkRestoreCode);
router.putAsync(
  "/addtable/:idUser/:idTable",
  auth(["admin", "user"]),
  controller.addUserTable,
);
// También el entrenador (Cuenta > Editar perfil daba 403). El controller ya
// exige que sea la cuenta propia (o admin) y el servicio solo acepta la lista
// blanca de users/user-profile.js: el email no se cambia por aquí.
router.putAsync("/", auth(["admin", "user", "trainer"]), controller.updateUser);

// Borrar la propia cuenta (verificar contraseña + borrar) también desde
// Trainers: el entrenador recibía 403 y no podía eliminar su cuenta. Los dos
// controllers ya exigen que sea la cuenta propia (o admin).
router.postAsync(
  "/verify-password",
  auth(["admin", "user", "trainer"]),
  controller.verifyPassword,
);
router.deleteAsync("/:id", auth(["admin", "user", "trainer"]), controller.deleteUser);
router.putAsync("/roles/:id", auth(["admin"]), controller.updateRoles);

module.exports = router;
