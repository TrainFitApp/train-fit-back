#!/usr/bin/env node
// Chequeo de la configuración de fotos y vídeos (docs/plan-medidas-multimedia.md):
// `npm run media:preflight`. Lee las variables R2_* y BUNNY_* del entorno y
// prueba contra Cloudflare R2 y Bunny Stream con el mismo código que usa el
// servidor. No imprime nunca claves ni secretos.
//
// Lo único que escribe es un objeto de prueba de 1 byte en R2
// (`preflight/…`), que borra al terminar. En Bunny solo lee.
require("dotenv").config();

const { r2Config, bunnyConfig } = require("../components/media/storage/media-config");
const r2 = require("../components/media/storage/r2-driver");
const axios = require("axios");

// Orígenes que tienen que poder subir: las apps nativas (iOS y Android) en el
// bucket de producción; `ionic serve` en el de desarrollo (`*-dev`).
const APP_ORIGINS = ["capacitor://localhost", "https://localhost"];
const DEV_ORIGINS = ["http://localhost:8100"];

const results = [];
const ok = (name, detail = "") => results.push({ ok: true, name, detail });
const fail = (name, detail = "") => results.push({ ok: false, name, detail });
const skip = (name, detail = "") => results.push({ ok: null, name, detail });

async function checkR2() {
  const config = r2Config();
  if (!config) {
    skip("R2", "sin R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET: se usará el disco local en desarrollo");
    return;
  }
  ok("R2 variables", `bucket ${config.bucket}, endpoint ${config.endpoint.includes(".eu.") ? "UE" : "global"}`);
  const driver = r2.create(config);
  const key = `preflight/${Date.now()}.txt`;
  const body = Buffer.from("x");

  let target;
  try {
    target = await driver.uploadTarget(key, { mime: "text/plain", bytes: body.length });
    ok("R2 firma de subida");
  } catch (error) {
    fail("R2 firma de subida", error.name || "error");
    return;
  }

  // CORS: el preflight que haría el móvil antes del PUT.
  for (const origin of config.bucket.endsWith("-dev") ? DEV_ORIGINS : APP_ORIGINS) {
    try {
      const response = await axios.options(target.url, {
        headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
        validateStatus: () => true,
      });
      const allowed = response.headers["access-control-allow-origin"];
      if (allowed === origin || allowed === "*") ok(`R2 CORS ${origin}`);
      else fail(`R2 CORS ${origin}`, "el bucket no permite este origen (Settings › CORS policy)");
    } catch (error) {
      fail(`R2 CORS ${origin}`, error.code || "sin respuesta");
    }
  }

  try {
    const response = await axios.put(target.url, body, { headers: target.headers, validateStatus: () => true });
    if (response.status >= 200 && response.status < 300) ok("R2 subida");
    else {
      fail("R2 subida", `HTTP ${response.status} (¿token sin permiso Object Read & Write en este bucket?)`);
      return;
    }
    const head = await driver.head(key);
    if (head?.bytes === body.length) ok("R2 lectura de metadatos");
    else fail("R2 lectura de metadatos", "el objeto no aparece");
    const url = await driver.readUrl(key);
    const get = await axios.get(url, { validateStatus: () => true });
    if (get.status === 200) ok("R2 descarga firmada");
    else fail("R2 descarga firmada", `HTTP ${get.status}`);
    await driver.deleteKeys([key]);
    ok("R2 borrado");
  } catch (error) {
    fail("R2 operación", error.name || error.code || "error");
  }
}

async function checkBunny(library) {
  const config = bunnyConfig(library);
  const label = library === "trainer" ? "Bunny librería entrenadores" : "Bunny librería clientes";
  if (!config) {
    skip(label, `sin BUNNY_{LIBRARY_ID,API_KEY,CDN_HOST} ni BUNNY_${library.toUpperCase()}_*: se usará el disco local en desarrollo`);
    return;
  }
  try {
    const response = await axios.get(`https://video.bunnycdn.com/library/${config.libraryId}/videos`, {
      params: { page: 1, itemsPerPage: 1 },
      headers: { AccessKey: config.apiKey, accept: "application/json" },
      validateStatus: () => true,
    });
    if (response.status === 200) ok(`${label} API`, `${response.data?.totalItems ?? 0} vídeos`);
    else fail(`${label} API`, `HTTP ${response.status} (¿Library ID o API Key de otra librería?)`);
  } catch (error) {
    fail(`${label} API`, error.code || "sin respuesta");
  }
  if (config.cdnTokenKey) ok(`${label} token de CDN`, "configurado");
  else fail(`${label} token de CDN`, "falta BUNNY_CDN_TOKEN_KEY (o la del bloque de esta librería): los vídeos quedarían accesibles sin firma");
  // Un MP4 que no existe tiene que dar 403 sin token (token activado) o 404.
  try {
    const url = `https://${config.cdnHost}/00000000-0000-0000-0000-000000000000/play_720p.mp4`;
    const response = await axios.head(url, { validateStatus: () => true });
    if (response.status === 403) ok(`${label} CDN`, "responde y exige token");
    else if (response.status === 404) fail(`${label} CDN`, "responde pero NO exige token (activa Token Authentication en la pull zone)");
    else ok(`${label} CDN`, `HTTP ${response.status}`);
  } catch (error) {
    fail(`${label} CDN`, error.code || "el CDN Hostname no responde");
  }
}

async function main() {
  await checkR2();
  await checkBunny("client");
  await checkBunny("trainer");
}

main()
  .catch((error) => fail("Preflight", error.message))
  .finally(() => {
    for (const result of results) {
      const mark = result.ok === true ? "OK  " : result.ok === false ? "FALLO" : "—   ";
      console.log(`${mark} ${result.name}${result.detail ? ` · ${result.detail}` : ""}`);
    }
    process.exit(results.some((result) => result.ok === false) ? 1 : 0);
  });
