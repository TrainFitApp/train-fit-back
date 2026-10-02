const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");

// El reproductor de YouTube (youtube-embed.html) nunca se versionó: en PRO
// puede existir como fichero suelto en la raíz del proyecto, y entonces manda
// ese. Si no está (local, PRE, tests), se sirve la plantilla versionada de
// static/ en vez de un 404.
const LOOSE_FILE = path.join(ROOT, "youtube-embed.html");
const FALLBACK_FILE = path.join(ROOT, "static/youtube-embed.html");

// Devuelve una promesa que se resuelve cuando el fichero ya se envió: los
// routers de @awaitjs/express llaman a next() si el handler termina sin
// cabeceras enviadas, y sendFile es asíncrono (acababa en 404).
function sendYouTubeEmbed(req, res, next) {
  const file = fs.existsSync(LOOSE_FILE) ? LOOSE_FILE : FALLBACK_FILE;
  return new Promise((resolve) => {
    res.sendFile(file, (error) => {
      if (error) next(error);
      resolve();
    });
  });
}

module.exports = { sendYouTubeEmbed };
