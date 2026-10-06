const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const TokenService = require('./token-service');
const token = (aud) => jwt.sign({ aud, type: 'refresh', sub: 'test-user', sid: 'test-session', pver: 0 }, 'fixture-secret');
const request = (family, cookies) => ({ headers: { 'x-client-family': family, cookie: Object.entries(cookies).map(([key,value]) => `${key}=${value}`).join('; ') } });

test('cookies de cliente, management y trainers no se pisan', () => {
  const jar = {};
  const families = ['trainfit-front','train-fit-management','trainfit-trainers'];
  for (const family of families) TokenService.setRefreshTokenCookie({cookie:(name,value)=>jar[name]=value}, token(family), family);
  assert.equal(Object.keys(jar).length, 3);
  for (const family of families) assert.equal(jwt.decode(TokenService.extractRefreshToken(request(family,jar)).token).aud, family);
});

test('lee solo la cookie de su app aunque haya otra sin familia', () => {
  const trainer = token('trainfit-trainers');
  const result = TokenService.extractRefreshToken(request('trainfit-trainers', {
    [TokenService.getRefreshCookieName()]: token('trainfit-front'),
    [TokenService.getRefreshCookieName('trainfit-trainers')]: trainer,
  }));
  assert.equal(result.token, trainer);
});

test('una cookie sin app (nombre sin familia) no sirve a ninguna app', () => {
  const jar = {[TokenService.getRefreshCookieName()]: token('trainfit-trainers')};
  assert.equal(TokenService.extractRefreshToken(request('trainfit-trainers',jar)).token, null);
});

test('logout borra solo la cookie de la app solicitada', () => {
  let cleared;
  TokenService.clearRefreshTokenCookie({cookie:(name,value,options)=>cleared={name,value,options}},'trainfit-trainers');
  assert.equal(cleared.name,TokenService.getRefreshCookieName('trainfit-trainers'));
  assert.equal(cleared.value,'');
  assert.equal(cleared.options.maxAge,0);
  assert.equal(cleared.options.httpOnly,true);
  assert.equal(cleared.options.path,'/api/auth');
});

test('native mantiene prioridad de cabecera y TTL no se amplía', () => {
  assert.equal(TokenService.extractRefreshToken({headers:{'x-refresh-token':'native-token'}}).token,'native-token');
  assert.equal(TokenService.ACCESS_TOKEN_TTL_SECONDS,900);
  assert.equal(TokenService.REFRESH_TOKEN_TTL_SECONDS,30*24*60*60);
  assert.ok(TokenService.getAllowedAudiences().includes('trainfit-trainers'));
});
