const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

// POST /auth/refresh contra el router real (auth-routes.js + errorHandler),
// con el servicio de usuarios sustituido. Sin .env, red ni base de datos.
const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.PRIVATE_KEY = keys.privateKey.export({ type: 'pkcs8', format: 'pem' });
process.env.PUBLIC_KEY = keys.publicKey.export({ type: 'spki', format: 'pem' });

const store = { findById: async () => null, touch: async () => null };
const userServicePath = require.resolve('../users/user-service');
require.cache[userServicePath] = {
  id: userServicePath,
  filename: userServicePath,
  loaded: true,
  exports: {
    view: async (value) => ({ _id: value._id }),
    getUserById: (...args) => store.findById(...args),
    touchSession: (...args) => store.touch(...args),
    clearSessionIfCurrent: async () => null,
  },
};

const express = require('express');
const TokenService = require('./token-service');
const { errorHandler } = require(path.join(__dirname, '../../middleware'));

const audience = 'trainfit-trainers';
const sessionId = 'fixture-session';
const refresh = TokenService.signRefresh({ sub: 'fixture-user', sid: sessionId, pver: 0 }, { audience });
const user = {
  _id: 'fixture-user',
  roles: ['trainer'],
  auth: { sessionId, clientFamily: audience, refreshTokenHash: TokenService.hashToken(refresh), refreshExpiresAt: TokenService.getExpirationDate(refresh) },
};

let baseUrl;
let server;
test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/auth', require('./auth-routes'));
  app.use(errorHandler);
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function postRefresh(cookie) {
  const response = await fetch(`${baseUrl}/auth/refresh`, {
    method: 'POST',
    headers: { 'x-client-platform': 'web', 'x-client-family': audience, cookie },
  });
  return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
}

test('acceso caducado a los 15 min se renueva con la cookie de su app aunque haya otra', async () => {
  const expiredAccess = TokenService.signAccess({ sub: user._id, sid: sessionId }, { audience, expiresIn: '-1s' });
  assert.equal(TokenService.verifyAccess(expiredAccess).payload, null);
  store.findById = async () => user;
  store.touch = async () => user;
  const other = TokenService.signRefresh({ sub: 'other-user', sid: 'other-session' }, { audience: 'trainfit-front' });
  const res = await postRefresh(`${TokenService.getRefreshCookieName(audience)}=${refresh}; ${TokenService.getRefreshCookieName('trainfit-front')}=${other}`);
  assert.equal(res.status, 200);
  const verified = TokenService.verifyAccess(res.body.access_token);
  assert.equal(verified.payload.aud, audience);
  assert.equal(verified.payload.sid, sessionId);
  assert.equal(verified.payload.exp - verified.payload.iat, 900);
  assert.equal(res.cookies.length, 1);
  assert.match(res.cookies[0], new RegExp(`^${TokenService.getRefreshCookieName(audience)}=`));
  assert.match(res.cookies[0], /HttpOnly/i);
});

test('un fallo de la base no borra la cookie del refresh', async () => {
  store.findById = async () => { throw Error('temporary database outage'); };
  const res = await postRefresh(`${TokenService.getRefreshCookieName(audience)}=${refresh}`);
  assert.equal(res.status, 500);
  assert.equal(res.cookies.length, 0);
});

test('sesión reemplazada: 401 terminal y solo se borra la cookie de Trainers', async () => {
  store.findById = async () => ({ ...user, auth: { ...user.auth, sessionId: 'another-session' } });
  const res = await postRefresh(`${TokenService.getRefreshCookieName(audience)}=${refresh}`);
  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'SESSION_REPLACED');
  assert.equal(res.body.requiresRelogin, true);
  assert.equal(res.cookies.length, 1);
  assert.match(res.cookies[0], new RegExp(`^${TokenService.getRefreshCookieName(audience)}=;`));
  assert.match(res.cookies[0], /Max-Age=0/i);
});
