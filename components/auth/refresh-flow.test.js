const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

// Claves efímeras del proceso de test. Sin .env, red ni base de datos.
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });
const TokenService = require('../../services/token.service');
const audience = 'trainfit-trainers';
const sessionId = 'fixture-session';
const refresh = TokenService.signRefresh({ sub: 'fixture-user', sid: sessionId, pver: 0 }, { audience });
const user = { _id: 'fixture-user', roles: ['trainer'], auth: { sessionId, clientFamily: audience, refreshTokenHash: TokenService.hashToken(refresh), refreshExpiresAt: TokenService.getExpirationDate(refresh) } };

function controllerWith(store) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'auth-controller.js'), 'utf8'), {
    module, exports: module.exports, Date, console: { info() {}, warn() {}, error() {} },
    require: (name) => name.includes('token.service') ? TokenService : name === '../users/schema' ? store : name === '../users/dto' ? { single: async (value) => ({ _id: value._id }) } : {},
  });
  return module.exports;
}
function response() {
  return { statusCode: 200, body: null, cookies: [], status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; }, cookie(name, value, options) { this.cookies.push({ name, value, options }); } };
}
const request = (cookie) => ({ headers: { 'x-client-platform': 'web', 'x-client-family': audience, cookie } });

test('acceso caducado a los 15 min renueva vía cookie propia aunque otra app escriba la antigua', async () => {
  const expiredAccess = TokenService.signAccess({ sub: user._id, sid: sessionId }, { audience, expiresIn: '-1s' });
  assert.equal(TokenService.verifyAccess(expiredAccess).payload, null);
  const controller = controllerWith({ findById: async () => user, findByIdAndUpdate: async () => user });
  const other = TokenService.signRefresh({ sub: 'other-user', sid: 'other-session' }, { audience: 'trainfit-front' });
  const res = response();
  await controller.refresh(request(`${TokenService.getRefreshCookieName(audience)}=${refresh}; ${TokenService.getRefreshCookieName()}=${other}`), res);
  assert.equal(res.statusCode, 200);
  const verified = TokenService.verifyAccess(res.body.access_token);
  assert.equal(verified.payload.aud, audience);
  assert.equal(verified.payload.sid, sessionId);
  assert.equal(verified.payload.exp - verified.payload.iat, 900);
  assert.equal(res.cookies[0].options.httpOnly, true);
});

test('cookie antigua válida migra; fallo de BD no borra refresh', async () => {
  const res = response();
  await controllerWith({ findById: async () => user, findByIdAndUpdate: async () => user }).refresh(request(`${TokenService.getRefreshCookieName()}=${refresh}`), res);
  assert.equal(res.cookies[0].name, TokenService.getRefreshCookieName(audience));
  assert.ok(res.cookies[0].options.maxAge <= 30 * 86400000);
  const failed = response();
  await controllerWith({ findById: async () => { throw Error('temporary database outage'); } }).refresh(request(`${TokenService.getRefreshCookieName(audience)}=${refresh}`), failed);
  assert.equal(failed.statusCode, 500);
  assert.equal(failed.cookies.length, 0);
});

test('sesión reemplazada sigue revocada y solo limpia cookie de Trainers', async () => {
  const res = response();
  await controllerWith({ findById: async () => ({ ...user, auth: { ...user.auth, sessionId: 'another-session' } }) }).refresh(request(`${TokenService.getRefreshCookieName(audience)}=${refresh}`), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'SESSION_REPLACED');
  assert.equal(res.cookies[0].name, TokenService.getRefreshCookieName(audience));
  assert.equal(res.cookies[0].options.maxAge, 0);
});
