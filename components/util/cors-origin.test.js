const test = require("node:test");
const assert = require("node:assert/strict");
const { isOriginAllowed, parseExtraOrigins } = require("./cors-origin");

// `dev` = arrancado con npm run serve (NODE_ENV=development).
// `serv` = el servidor real: `./bin/www` a secas, sin NODE_ENV.
const dev = { isDevelopment: true };
const serv = { isDevelopment: false };

test("isOriginAllowed", async (t) => {
  await t.test("sin Origin (curl, app nativa) pasa siempre", () => {
    assert.equal(isOriginAllowed(undefined, dev), true);
    assert.equal(isOriginAllowed(undefined, serv), true);
  });

  // `npm start` (sin NODE_ENV) tiene que seguir sirviendo a las apps del
  // monorepo: son los puertos de siempre, no un permiso de desarrollo.
  await t.test("webviews nativas y los dos puertos de siempre pasan con cualquier arranque", () => {
    for (const origin of [
      "capacitor://localhost",
      "ionic://localhost",
      "http://localhost",
      "http://localhost:8100",
      "http://localhost:8101",
    ]) {
      assert.equal(isOriginAllowed(origin, serv), true, origin);
    }
  });

  await t.test("en desarrollo vale cualquier puerto local", () => {
    for (const origin of [
      "http://localhost:8100",
      "http://localhost:8102",
      "http://localhost:4200",
      "http://127.0.0.1:8105",
      "http://[::1]:9000",
    ]) {
      assert.equal(isOriginAllowed(origin, dev), true, origin);
    }
  });

  // La razón de existir de este módulo: los permisos anchos están CERRADOS
  // salvo que quien arranca el proceso los pida. Sin NODE_ENV (el servidor
  // real, y cualquiera que se olvide de configurarlo) no se abre nada.
  await t.test("sin NODE_ENV=development no pasa ningún OTRO puerto local", () => {
    assert.equal(isOriginAllowed("http://localhost:8102", serv), false);
    assert.equal(isOriginAllowed("http://localhost:4200", serv), false);
    assert.equal(isOriginAllowed("http://127.0.0.1:8100", serv), false);
  });

  await t.test("opciones ausentes = cerrado (nadie pasa options por error)", () => {
    assert.equal(isOriginAllowed("http://localhost:8102"), false);
    assert.equal(isOriginAllowed("http://localhost:8102", {}), false);
  });

  await t.test("CORS_OPEN solo abre si además es desarrollo", () => {
    assert.equal(isOriginAllowed("http://192.168.1.40:8100", { ...dev, fullyOpen: true }), true);
    assert.equal(isOriginAllowed("https://evil.example.com", { ...serv, fullyOpen: true }), false);
  });

  await t.test("un origen externo nunca pasa por su cuenta", () => {
    assert.equal(isOriginAllowed("https://evil.example.com", dev), false);
    assert.equal(isOriginAllowed("http://localhost.evil.com", dev), false);
    assert.equal(isOriginAllowed("http://192.168.1.40:8100", dev), false);
  });

  // La web de Trainers en producción: se declara en CORS_EXTRA_ORIGINS y pasa aunque no sea desarrollo.
  await t.test("CORS_EXTRA_ORIGINS abre solo los orígenes https exactos declarados", () => {
    const extraOrigins = parseExtraOrigins(" https://trainers.example.com , http://inseguro.example.com, https://x.example.com/ruta, basura,");
    assert.deepEqual(extraOrigins, ["https://trainers.example.com"]);
    assert.equal(isOriginAllowed("https://trainers.example.com", { ...serv, extraOrigins }), true);
    assert.equal(isOriginAllowed("https://trainers.example.com.evil.com", { ...serv, extraOrigins }), false);
    assert.equal(isOriginAllowed("https://evil.example.com", { ...serv, extraOrigins }), false);
    assert.deepEqual(parseExtraOrigins(undefined), []);
  });
});
