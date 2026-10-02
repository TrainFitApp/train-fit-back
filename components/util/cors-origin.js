// Qué origen puede hablar con la API.
//
// PURO: entra un origen y la configuración, sale un booleano. Vive aparte de
// app.js para poder probar la regla que de verdad importa — que el permiso
// ancho de desarrollo esté CERRADO salvo que alguien lo abra a propósito.

// Orígenes fijos, válidos con cualquier arranque: las webviews nativas
// (Capacitor/Ionic), localhost sin puerto, y los dos puertos que `ionic
// serve` reparte primero — son los de siempre y `npm start` tiene que seguir
// sirviendo a las apps del monorepo sin pedir nada más.
const ALWAYS_ALLOWED = [
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:8100",
  "http://localhost:8101",
  // App de profesionales publicada como web (producción y PRE).
  "https://trainers.trainfit.net",
  "https://trainers-dev.trainfit.net",
];

// A partir de la TERCERA app del monorepo `ionic serve` ya reparte 8102,
// 8103… y el número cambia según el orden de arranque, así que mantenerlos a
// mano arriba significaba que ese servidor moría en el preflight hasta
// añadirlo. En desarrollo vale cualquier puerto de la máquina local.
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * Lo de arriba vale siempre; lo ANCHO lo pide quien arranca el proceso. Los
 * scripts de desarrollo (`npm run serve`, `serve:open`) ponen
 * NODE_ENV=development; el servidor arranca `./bin/www` a secas (ver
 * ecosystem.config.js), así que allí no hay NODE_ENV y no se abre de más
 * aunque nadie se acuerde de configurarlo: olvidarse falla hacia lo seguro.
 *
 * @param {string|undefined} origin  el header Origin (ausente en peticiones
 *   que no son de navegador: curl, apps nativas)
 * @param {{ isDevelopment: boolean, fullyOpen?: boolean }} options
 *   fullyOpen = CORS_OPEN=1 (ver npm run serve:open): refleja CUALQUIER
 *   origen, para cuando es una IP de la red local (simulador o dispositivo
 *   físico con livereload). Sin isDevelopment no hace nada.
 */
function isOriginAllowed(
  origin,
  { isDevelopment = false, fullyOpen = false } = {},
) {
  if (!origin) return true;
  if (ALWAYS_ALLOWED.includes(origin)) return true;
  if (!isDevelopment) return false;
  if (fullyOpen) return true;
  return LOCAL_ORIGIN.test(origin);
}

module.exports = { isOriginAllowed, ALWAYS_ALLOWED, LOCAL_ORIGIN };
