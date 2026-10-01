const fs = require("fs");
const path = require("path");
const mediaService = require("./media-service");
const { localDriver } = require("./storage");

// Origen del backend tal y como lo ve la app: con él se construyen las URL
// del almacenamiento local de desarrollo.
function baseUrlOf(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function send(res, result, status = 200) {
  if (result?.error) {
    const { status: errorStatus, code, message } = result.error;
    return res.status(errorStatus).send({ message, code });
  }
  return res.status(status).send(result);
}

module.exports = {
  baseUrlOf,
  send,

  // GET /media/status — qué puede hacer este usuario y si hay almacenamiento.
  async status(req, res) {
    return res.send(await mediaService.status(req.user));
  },

  // POST /media/consent — acepta cómo se guardan sus fotos y vídeos.
  async consent(req, res) {
    return res.send(await mediaService.giveConsent(req.user));
  },

  // POST /media/uploads — firma una subida directa al almacenamiento.
  async createUpload(req, res) {
    return send(res, await mediaService.createUpload(req.user, req.body || {}, { baseUrl: baseUrlOf(req) }), 201);
  },

  // POST /media/uploads/:id/complete — la app terminó de subir.
  async completeUpload(req, res) {
    return send(res, await mediaService.completeUpload(req.user, req.params.id, { baseUrl: baseUrlOf(req) }));
  },

  // DELETE /media/uploads/:id — cancela una subida sin confirmar.
  async cancelUpload(req, res) {
    return send(res, await mediaService.cancelUpload(req.user, req.params.id));
  },

  // POST /media/webhooks/bunny — Bunny avisa de un cambio de estado.
  async bunnyWebhook(req, res) {
    await mediaService.handleBunnyWebhook(req.body);
    return res.sendStatus(200);
  },

  // PUT /media/local/:token — subida al disco local (solo desarrollo).
  async localPut(req, res) {
    const claims = localDriver.verify(req.params.token);
    if (!claims || claims.op !== "put") return res.status(403).send({ message: "Enlace de subida no válido" });
    const target = localDriver.filePathOf(claims.key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    let received = 0;
    let aborted = false;
    const out = fs.createWriteStream(target);
    await new Promise((resolve) => {
      req.on("data", (chunk) => {
        received += chunk.length;
        // Nunca más de lo firmado.
        if (received > claims.max && !aborted) {
          aborted = true;
          req.unpipe(out);
          out.destroy();
          resolve();
        }
      });
      req.pipe(out);
      out.on("finish", resolve);
      out.on("error", resolve);
      req.on("aborted", () => {
        aborted = true;
        resolve();
      });
    });
    if (aborted) {
      await fs.promises.rm(target, { force: true });
      return res.status(413).send({ message: "El archivo supera lo permitido" });
    }
    return res.sendStatus(200);
  },

  // GET /media/local/:token — lectura del disco local (admite Range para
  // poder saltar a un segundo del vídeo).
  async localGet(req, res) {
    const claims = localDriver.verify(req.params.token);
    if (!claims || claims.op !== "get") return res.status(403).send({ message: "Enlace caducado" });
    const target = localDriver.filePathOf(claims.key);
    if (!fs.existsSync(target)) return res.sendStatus(404);
    res.set("Cache-Control", "private, max-age=3000");
    // Se espera a que termine: @awaitjs/express llama a next() (404) si la
    // promesa acaba antes de haber enviado nada. Y la carpeta es .media-local:
    // sin dotfiles "allow", sendFile la trataría como oculta.
    await new Promise((resolve) => {
      res.sendFile(target, { dotfiles: "allow" }, (error) => {
        if (error && !res.headersSent) res.sendStatus(error.status || 500);
        resolve();
      });
    });
  },
};
