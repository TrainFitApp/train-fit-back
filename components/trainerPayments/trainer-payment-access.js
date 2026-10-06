const mongoose = require("mongoose");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const { relationState } = require("../trainerClients/pair-state");
const seatService = require("../trainerClients/trainer-seat-service");

// Autorización FINANCIERA acotada para /trainer/payments/clients/:clientId/*.
// No sustituye ni relaja requireActiveClient: solo decide quién puede ver y
// cerrar SUS cobros con un cliente.
//
//   - Cliente activo (algún scope activo con este entrenador): todo, pero las
//     escrituras respetan las plazas (solo lectura → 403 CLIENT_READ_ONLY),
//     igual que el resto de la ficha.
//   - Antiguo cliente (solo relaciones revocadas): con `allowFormer`, leer y
//     cerrar la deuda existente (registrar, corregir, anular, editar un cobro).
//     Nunca crear cuotas ni cobros nuevos, ni activar avisos. No ocupa plaza,
//     así que el límite de plazas no le aplica, pero tampoco desbloquea nada
//     más (entrenamiento, nutrición, ficha).
//   - Cualquier otro (otro entrenador, sin relación, el propio entrenador): 403.
//
// El entrenador sale SIEMPRE de la sesión (req.auth.userId).
function requirePaymentsAccess({ allowFormer = false, write = false } = {}) {
  return async (req, res, next) => {
    try {
      const trainerId = req.auth.userId;
      const { clientId } = req.params;
      if (!mongoose.isValidObjectId(clientId) || String(clientId) === String(trainerId)) {
        return res.status(403).send({ code: "NO_RELATION", message: "No tienes relación con este cliente." });
      }
      const access = relationState(await trainerClientDao.findPair(trainerId, clientId));
      if (!access) return res.status(403).send({ code: "NO_RELATION", message: "No tienes relación con este cliente." });
      if (access === "former" && !allowFormer) {
        return res.status(403).send({
          code: "FORMER_CLIENT_RESTRICTED",
          message: "Con un antiguo cliente solo puedes consultar y cerrar la deuda que ya existe.",
        });
      }
      if (access === "active" && write && (await seatService.rejectIfReadOnly(req, res, clientId))) return;
      req.paymentsAccess = access;
      next();
    } catch (error) {
      console.error("Error en requirePaymentsAccess:", error.message);
      res.status(500).send({ message: "Internal Server Error" });
    }
  };
}

module.exports = { requirePaymentsAccess };
