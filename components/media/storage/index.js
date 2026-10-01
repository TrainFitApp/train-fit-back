// Punto único para elegir almacenamiento. El resto del backend nunca sabe si
// habla con R2, Bunny o el disco local.

const { r2Config, bunnyConfig, localAllowed } = require("./media-config");
const localDriver = require("./local-driver");
const r2 = require("./r2-driver");
const bunny = require("./bunny-driver");

function imageDriver() {
  const config = r2Config();
  if (config) return r2.create(config);
  return localAllowed() ? localDriver : null;
}

/** @param {"client"|"trainer"} library */
function videoDriver(library) {
  const config = bunnyConfig(library);
  if (config) return bunny.create(config);
  return localAllowed() ? localDriver : null;
}

function imageDriverByName(name) {
  if (name === "local") return localDriver;
  const config = r2Config();
  return name === "r2" && config ? r2.create(config) : null;
}

function bunnyByLibrary(library) {
  const config = bunnyConfig(library);
  return config ? bunny.create(config) : null;
}

module.exports = { imageDriver, videoDriver, imageDriverByName, bunnyByLibrary, localDriver };
