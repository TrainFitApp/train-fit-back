const { test } = require("node:test");
const assert = require("node:assert/strict");
const h = require("./support/harness");

// Sesiones de punta a punta: login, refresco, cierre, una sesión por cuenta,
// aislamiento por app y todo lo que debe invalidar un token ya emitido.

const ctx = h.setup();
const PASSWORD = "Secreta-123";

let ipSeq = 0;
// /auth/activate y /auth/resend-code llevan un limitador de 5 peticiones por
// IP y minuto: cada test usa su propia IP para no contaminarse.
const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;

function login(email, password, family = h.FAMILY.client, platform = "web") {
  return ctx.raw("POST", "/auth/login", { email, password }, { "x-client-family": family, "x-client-platform": platform });
}

function withAccess(body, family) {
  return { token: body.access_token, family };
}

test("login correcto: devuelve access token válido, el usuario sin secretos y la cookie de refresco de SU app", async () => {
  const user = await ctx.makeClient({ name: "Lara", password: PASSWORD });
  const res = await login(user.email, PASSWORD);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.token_type, "Bearer");
  assert.equal(res.body.expires_in, 15 * 60);
  assert.equal(res.body.is_impersonating, false);
  assert.equal(res.body.user.email, user.email);
  assert.equal(res.body.user.password, undefined, "el hash de la contraseña nunca sale");
  assert.equal(res.body.user.auth, undefined, "los datos de sesión nunca salen");
  assert.equal(res.body.refresh_token, undefined, "en web el refresh va solo en cookie");

  const cookie = res.cookies["tfRefreshToken-trainfit-front"];
  assert.ok(cookie?.value, "cookie con nombre propio de la app cliente");
  assert.ok(cookie.attrs.includes("httponly"));
  assert.ok(cookie.attrs.includes("path=/api/auth"));

  const me = await ctx.call(withAccess(res.body, h.FAMILY.client), "GET", "/auth/me");
  assert.equal(me.status, 200);
  assert.equal(String(me.body.user._id), user.id);
});

test("login nativo: el refresh viaja en el cuerpo y no se pone cookie", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  const res = await login(user.email, PASSWORD, h.FAMILY.client, "ios");
  assert.equal(res.status, 200);
  assert.ok(res.body.refresh_token);
  assert.equal(Object.keys(res.cookies).length, 0);
});

test("email con mayúsculas y espacios inicia sesión igual (se normaliza)", async () => {
  const user = await ctx.makeClient({ password: PASSWORD, email: "mixto.case@example.test" });
  const res = await login("  Mixto.CASE@Example.TEST ", PASSWORD);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.user.email, user.email);
});

test("credenciales malas: misma respuesta para contraseña errónea y email inexistente (sin enumeración)", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  const wrongPassword = await login(user.email, "otra-cosa");
  const unknownEmail = await login("nadie.existe@example.test", PASSWORD);
  assert.equal(wrongPassword.status, 401);
  assert.equal(unknownEmail.status, 401);
  assert.deepEqual(wrongPassword.body, unknownEmail.body);
  assert.equal(wrongPassword.body.code, "INVALID_CREDENTIALS");
});

test("login sin email o sin contraseña: 400", async () => {
  assert.equal((await ctx.raw("POST", "/auth/login", { email: "a@b.es" })).status, 400);
  assert.equal((await ctx.raw("POST", "/auth/login", { password: "x" })).status, 400);
});

test("cada rol entra solo en su app: profesional en la de clientes y cliente en Trainers dan WRONG_APP_FOR_ROLE", async () => {
  const trainer = await ctx.makeTrainer({ password: PASSWORD });
  const client = await ctx.makeClient({ password: PASSWORD });

  const trainerInClientApp = await login(trainer.email, PASSWORD, h.FAMILY.client);
  assert.equal(trainerInClientApp.status, 403);
  assert.equal(trainerInClientApp.body.code, "WRONG_APP_FOR_ROLE");

  const clientInTrainerApp = await login(client.email, PASSWORD, h.FAMILY.trainer);
  assert.equal(clientInTrainerApp.status, 403);
  assert.equal(clientInTrainerApp.body.code, "WRONG_APP_FOR_ROLE");

  assert.equal((await login(trainer.email, PASSWORD, h.FAMILY.trainer)).status, 200);
  assert.equal((await login(client.email, PASSWORD, h.FAMILY.client)).status, 200);

  // Una cuenta con los dos roles pasa en las dos apps (roles inclusivos).
  const both = await ctx.makeUser({ roles: ["user", "trainer"], password: PASSWORD });
  assert.equal((await login(both.email, PASSWORD, h.FAMILY.client)).status, 200);
  assert.equal((await login(both.email, PASSWORD, h.FAMILY.trainer)).status, 200);
});

test("cuenta sin verificar: el login responde ACCOUNT_NOT_VERIFIED, rota el código y lo manda por correo", async () => {
  const user = await ctx.makeClient({ password: PASSWORD, fields: { hash: "111111" } });
  const before = ctx.sentMail.length;
  const res = await login(user.email, PASSWORD);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "ACCOUNT_NOT_VERIFIED");
  const stored = await ctx.model("User").findById(user.id).lean();
  assert.notEqual(stored.hash, "111111", "se genera un código nuevo");
  assert.match(stored.hash, /^\d{6}$/);
  assert.equal(ctx.sentMail.length, before + 1);
  assert.equal(ctx.sentMail.at(-1).args[0], user.email);
  // Y no se crea sesión.
  assert.equal(stored.auth?.sessionId ?? null, user.sessionId, "la sesión previa no se toca");
});

test("una sesión por cuenta: el segundo login expulsa al primero (SESSION_REPLACED) aunque sea desde otra app", async () => {
  const user = await ctx.makeUser({ roles: ["user", "trainer"], password: PASSWORD });
  const first = await login(user.email, PASSWORD, h.FAMILY.client);
  const firstAccess = withAccess(first.body, h.FAMILY.client);
  assert.equal((await ctx.call(firstAccess, "GET", "/auth/me")).status, 200);

  const second = await login(user.email, PASSWORD, h.FAMILY.trainer);
  assert.equal(second.status, 200);

  const replaced = await ctx.call(firstAccess, "GET", "/auth/me");
  assert.equal(replaced.status, 401);
  assert.equal(replaced.body.code, "SESSION_REPLACED");
  assert.equal(replaced.body.requiresRelogin, true);

  // El refresco de la sesión expulsada tampoco sirve.
  const refreshOld = await ctx.raw("POST", "/auth/refresh", {}, {
    "x-client-family": h.FAMILY.client,
    cookie: `tfRefreshToken-trainfit-front=${first.cookies["tfRefreshToken-trainfit-front"].value}`,
  });
  assert.equal(refreshOld.status, 401);
  assert.equal(refreshOld.body.code, "SESSION_REPLACED");
});

test("refresco: cookie de la app da un access nuevo de la MISMA sesión, sin rotar el refresh", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  const first = await login(user.email, PASSWORD);
  const cookie = first.cookies["tfRefreshToken-trainfit-front"].value;

  const refreshed = await ctx.raw("POST", "/auth/refresh", {}, {
    "x-client-family": h.FAMILY.client,
    cookie: `tfRefreshToken-trainfit-front=${cookie}`,
  });
  assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));
  assert.ok(refreshed.body.access_token);
  assert.equal(refreshed.cookies["tfRefreshToken-trainfit-front"].value, cookie, "misma cookie, sesión no ampliada");

  // El access viejo y el nuevo valen a la vez: es la misma sesión.
  assert.equal((await ctx.call(withAccess(first.body, h.FAMILY.client), "GET", "/auth/me")).status, 200);
  assert.equal((await ctx.call(withAccess(refreshed.body, h.FAMILY.client), "GET", "/auth/me")).status, 200);
});

test("refresco nativo por cabecera x-refresh-token", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  const first = await login(user.email, PASSWORD, h.FAMILY.client, "android");
  const refreshed = await ctx.raw("POST", "/auth/refresh", {}, {
    "x-client-family": h.FAMILY.client,
    "x-client-platform": "android",
    "x-refresh-token": first.body.refresh_token,
  });
  assert.equal(refreshed.status, 200);
  assert.equal(Object.keys(refreshed.cookies).length, 0, "en nativo nunca se ponen cookies");
});

test("refresco con un token de otra app (audiencia distinta) se rechaza", async () => {
  const user = await ctx.makeUser({ roles: ["user", "trainer"], password: PASSWORD });
  const trainerLogin = await login(user.email, PASSWORD, h.FAMILY.trainer, "ios");
  const crossed = await ctx.raw("POST", "/auth/refresh", {}, {
    "x-client-family": h.FAMILY.client,
    "x-client-platform": "ios",
    "x-refresh-token": trainerLogin.body.refresh_token,
  });
  assert.equal(crossed.status, 401);
  assert.equal(crossed.body.requiresRelogin, true);
});

test("refresco sin token o con basura: 401 REFRESH_INVALID", async () => {
  const none = await ctx.raw("POST", "/auth/refresh", {}, { "x-client-family": h.FAMILY.client });
  assert.equal(none.status, 401);
  assert.equal(none.body.code, "REFRESH_INVALID");
  const garbage = await ctx.raw("POST", "/auth/refresh", {}, { "x-client-family": h.FAMILY.client, "x-refresh-token": "no.es.un.jwt" });
  assert.equal(garbage.status, 401);
});

test("logout: invalida el access y el refresh de esa sesión y borra la cookie", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  const first = await login(user.email, PASSWORD);
  const access = withAccess(first.body, h.FAMILY.client);
  const cookie = first.cookies["tfRefreshToken-trainfit-front"].value;

  const out = await ctx.call(access, "POST", "/auth/logout");
  assert.equal(out.status, 200);
  assert.equal(out.cookies["tfRefreshToken-trainfit-front"].value, "", "cookie vaciada");

  assert.equal((await ctx.call(access, "GET", "/auth/me")).status, 401);
  const refresh = await ctx.raw("POST", "/auth/refresh", {}, {
    "x-client-family": h.FAMILY.client,
    cookie: `tfRefreshToken-trainfit-front=${cookie}`,
  });
  assert.equal(refresh.status, 401);
});

test("logout de una sesión ya sustituida NO cierra la sesión nueva", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  const oldLogin = await login(user.email, PASSWORD);
  const newLogin = await login(user.email, PASSWORD);
  await ctx.call(withAccess(oldLogin.body, h.FAMILY.client), "POST", "/auth/logout");
  assert.equal((await ctx.call(withAccess(newLogin.body, h.FAMILY.client), "GET", "/auth/me")).status, 200);
});

test("token con audiencia de otra app que la cabecera x-client-family: 401", async () => {
  const user = await ctx.makeClient();
  const res = await ctx.call(user, "GET", "/auth/me", undefined, { family: h.FAMILY.trainer });
  assert.equal(res.status, 401);
});

test("access caducado: 401 ACCESS_EXPIRED (el front refresca con ese código)", async () => {
  const user = await ctx.makeClient();
  const token = ctx.signFor(user, { expiresIn: -10 });
  const res = await ctx.call(user, "GET", "/auth/me", undefined, { token });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "ACCESS_EXPIRED");
});

test("sin token o con token mal formado: 401", async () => {
  assert.equal((await ctx.raw("GET", "/auth/me")).status, 401);
  const user = await ctx.makeClient();
  const res = await ctx.call(user, "GET", "/auth/me", undefined, { token: "abc.def.ghi" });
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "ACCESS_INVALID");
});

test("sesión con refresco vencido en BD: 401 REFRESH_EXPIRED y la sesión se borra", async () => {
  const user = await ctx.makeClient();
  await ctx.model("User").updateOne({ _id: user._id }, { $set: { "auth.refreshExpiresAt": new Date(Date.now() - 1000) } });
  const res = await ctx.call(user, "GET", "/auth/me");
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "REFRESH_EXPIRED");
  const stored = await ctx.model("User").findById(user.id).lean();
  assert.equal(stored.auth, undefined);
});

test("cambio de contraseña (versión distinta a la del token): 401 PASSWORD_CHANGED", async () => {
  const user = await ctx.makeClient();
  await ctx.model("User").updateOne({ _id: user._id }, { $inc: { passwordVersion: 1 } });
  const res = await ctx.call(user, "GET", "/auth/me");
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "PASSWORD_CHANGED");
});

test("usuario borrado: su token ya no vale (USER_NOT_FOUND)", async () => {
  const user = await ctx.makeClient();
  await ctx.model("User").collection.deleteOne({ _id: user._id });
  const res = await ctx.call(user, "GET", "/auth/me");
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "USER_NOT_FOUND");
});

test("roles por endpoint: cliente en ruta de profesional y profesional en ruta de cliente dan 403", async () => {
  const client = await ctx.makeClient();
  const trainer = await ctx.makeTrainer();
  assert.equal((await ctx.call(client, "GET", "/trainer/clients")).status, 403);
  assert.equal((await ctx.call(trainer, "GET", "/auth/me")).status, 403);
  assert.equal((await ctx.call(client, "GET", "/config/admin")).status, 403);
  assert.equal((await ctx.call(trainer, "GET", "/config/admin")).status, 403);
});

test("restablecer contraseña: el código cambia la contraseña, expulsa la sesión abierta y permite entrar con la nueva", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  const session = await login(user.email, PASSWORD);
  const access = withAccess(session.body, h.FAMILY.client);

  const ask = await ctx.raw("GET", `/users/send/mail/code/${encodeURIComponent(user.email)}`, undefined, { "x-forwarded-for": freshIp() });
  assert.equal(ask.status, 200);
  const { restoreCode } = await ctx.model("User").findById(user.id).lean();
  assert.ok(restoreCode, "código guardado");

  const wrong = await ctx.raw("POST", "/users/send/mail/code", { email: user.email, password: "Nueva-456", hash: "000000" === restoreCode ? "111111" : "000000" });
  assert.equal(wrong.status, 400);

  const ok = await ctx.raw("POST", "/users/send/mail/code", { email: user.email, password: "Nueva-456", hash: restoreCode });
  assert.equal(ok.status, 200);

  assert.equal((await ctx.call(access, "GET", "/auth/me")).status, 401, "la sesión abierta cae");
  assert.equal((await login(user.email, PASSWORD)).status, 401, "la contraseña vieja ya no sirve");
  assert.equal((await login(user.email, "Nueva-456")).status, 200);

  // El código es de un solo uso.
  const reuse = await ctx.raw("POST", "/users/send/mail/code", { email: user.email, password: "Otra-789", hash: restoreCode });
  assert.equal(reuse.status, 400);
});

test("restablecer contraseña: la respuesta no expone el hash de la contraseña ni la sesión", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  await ctx.raw("GET", `/users/send/mail/code/${encodeURIComponent(user.email)}`, undefined, { "x-forwarded-for": freshIp() });
  const { restoreCode } = await ctx.model("User").findById(user.id).lean();
  const ok = await ctx.raw("POST", "/users/send/mail/code", { email: user.email, password: "Nueva-456", hash: restoreCode });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.password, undefined);
  assert.equal(ok.body.auth, undefined);
});

test("restablecer contraseña: tras 5 códigos erróneos se bloquea aunque luego llegue el bueno", async () => {
  const user = await ctx.makeClient({ password: PASSWORD });
  await ctx.raw("GET", `/users/send/mail/code/${encodeURIComponent(user.email)}`, undefined, { "x-forwarded-for": freshIp() });
  const { restoreCode } = await ctx.model("User").findById(user.id).lean();
  const bad = restoreCode === "999999" ? "888888" : "999999";
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await ctx.raw("POST", "/users/send/mail/code", { email: user.email, password: "X-1", hash: bad })).status, 400);
  }
  const late = await ctx.raw("POST", "/users/send/mail/code", { email: user.email, password: "X-1", hash: restoreCode });
  assert.equal(late.status, 400);
  assert.equal((await login(user.email, PASSWORD)).status, 200, "la contraseña no cambió");
});

test("pedir código de restablecimiento: email inexistente responde igual que uno real (anti-enumeración) y el cooldown de 60 s se respeta", async () => {
  const user = await ctx.makeClient();
  const unknown = await ctx.raw("GET", "/users/send/mail/code/nadie.mas@example.test", undefined, { "x-forwarded-for": freshIp() });
  const known = await ctx.raw("GET", `/users/send/mail/code/${encodeURIComponent(user.email)}`, undefined, { "x-forwarded-for": freshIp() });
  assert.equal(unknown.status, 200);
  assert.equal(known.status, 200);
  assert.deepEqual(unknown.body, known.body);

  const again = await ctx.raw("GET", `/users/send/mail/code/${encodeURIComponent(user.email)}`, undefined, { "x-forwarded-for": freshIp() });
  assert.equal(again.status, 429);
});

test("registro de cliente: alta sin verificar, correo con código, activación y login", async () => {
  const email = `alta.${Date.now()}@example.test`;
  const created = await ctx.raw("POST", "/users", {
    user: { name: "Alta", lastname: "Nueva", email: `  ${email.toUpperCase()} `, password: PASSWORD, sex: 1, height: 170, weight: 70 },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.email, email, "email normalizado al guardar");
  assert.deepEqual(created.body.roles, ["user"]);
  const stored = await ctx.model("User").findOne({ email }).lean();
  assert.match(stored.hash, /^\d{6}$/);
  assert.notEqual(stored.password, PASSWORD, "contraseña cifrada");
  assert.ok(ctx.sentMail.some((m) => m.fn === "sendTransactionalMail" && m.args[0] === email));

  // Duplicado: 409 aunque cambien mayúsculas, con código para la app.
  const dup = await ctx.raw("POST", "/users", { user: { name: "Otra", email: email.toUpperCase(), password: "x" } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.code, "EMAIL_ALREADY_REGISTERED");

  // Sin activar no entra.
  assert.equal((await login(email, PASSWORD)).status, 403);
  const { hash } = await ctx.model("User").findOne({ email }).lean();

  const ip = freshIp();
  const wrong = await ctx.raw("POST", "/auth/activate", { email, code: hash === "123456" ? "654321" : "123456" }, { "x-forwarded-for": ip });
  assert.equal(wrong.status, 400);
  const malformed = await ctx.raw("POST", "/auth/activate", { email, code: "12ab" }, { "x-forwarded-for": ip });
  assert.equal(malformed.status, 400);

  const activated = await ctx.raw("POST", "/auth/activate", { email, code: hash }, { "x-forwarded-for": ip, "x-client-family": h.FAMILY.client });
  assert.equal(activated.status, 200, JSON.stringify(activated.body));
  assert.ok(activated.body.access_token, "activar abre sesión directamente");

  const again = await ctx.raw("POST", "/auth/activate", { email, code: hash }, { "x-forwarded-for": freshIp() });
  assert.equal(again.status, 400, "ya verificada");

  assert.equal((await login(email, PASSWORD)).status, 200);
});

test("activación: 5 fallos bloquean el código aunque después llegue el correcto (TOO_MANY_ATTEMPTS)", async () => {
  const user = await ctx.makeClient({ fields: { hash: "246810", hashExpiresAt: new Date(Date.now() + 600000) } });
  const ip = freshIp();
  for (let i = 0; i < 5; i += 1) {
    const r = await ctx.raw("POST", "/auth/activate", { email: user.email, code: "135791" }, { "x-forwarded-for": `${ip}-${i}` });
    assert.equal(r.status, 400);
  }
  const blocked = await ctx.raw("POST", "/auth/activate", { email: user.email, code: "246810" }, { "x-forwarded-for": freshIp() });
  assert.equal(blocked.status, 429);
});

test("activación: código caducado da CODE_EXPIRED", async () => {
  const user = await ctx.makeClient({ fields: { hash: "246810", hashExpiresAt: new Date(Date.now() - 1000) } });
  const res = await ctx.raw("POST", "/auth/activate", { email: user.email, code: "246810" }, { "x-forwarded-for": freshIp() });
  assert.equal(res.status, 400);
  assert.match(res.body.message, /expirado/i);
});

test("registro de profesional: rol trainer, sin días de dieta y solo entra en Trainers", async () => {
  const email = `pro.${Date.now()}@example.test`;
  const created = await ctx.raw("POST", "/users/professional", { name: "Pro", lastname: "Fesional", email, password: PASSWORD });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.deepEqual(created.body.roles, ["trainer"]);
  const stored = await ctx.model("User").findOne({ email }).lean();
  assert.equal(await ctx.count("DietDay", { userId: stored._id }), 0);

  const missing = await ctx.raw("POST", "/users/professional", { name: "Pro", email: `x${email}` });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "SIGNUP_FIELDS_REQUIRED");

  await ctx.model("User").updateOne({ _id: stored._id }, { $unset: { hash: 1 } });
  assert.equal((await login(email, PASSWORD, h.FAMILY.trainer)).status, 200);
  assert.equal((await login(email, PASSWORD, h.FAMILY.client)).status, 403);
});

// QA 2026-10-09 (A5): con el correo caído, el alta respondía 500 con la
// cuenta ya creada y el reintento decía «Este correo ya está registrado».
const mail = require("../components/util/mail");

async function withMailDown(fn) {
  const original = mail.sendTransactionalMail;
  mail.sendTransactionalMail = async () => {
    throw new Error("Resend caído");
  };
  try {
    return await fn();
  } finally {
    mail.sendTransactionalMail = original;
  }
}

test("alta con el correo caído: la cuenta queda creada y la respuesta lo dice, sin 500; «Reenviar código» funciona sin esperar", async () => {
  const email = `caido.${Date.now()}@example.test`;
  const created = await withMailDown(() =>
    ctx.raw("POST", "/users", { user: { name: "Caído", lastname: "Correo", email, password: PASSWORD, sex: 1, height: 170, weight: 70 } }),
  );
  assert.equal(created.status, 200, JSON.stringify(created.body));
  assert.equal(created.body.verificationMailSent, false);
  const stored = await ctx.model("User").findOne({ email }).lean();
  assert.match(stored.hash, /^\d{6}$/, "el código está guardado");
  assert.equal(stored.lastHashSentAt ?? null, null, "sin la espera de un minuto");

  // Reenviar en el acto: ahora el correo sí sale.
  const before = ctx.sentMail.length;
  const resent = await ctx.raw("POST", "/auth/resend-code", { email }, { "x-forwarded-for": freshIp() });
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  assert.equal(ctx.sentMail.length, before + 1);

  // Si al reenviar sigue caído, se dice (503, que la app explica: los 5xx no
  // llevan detalles) y se puede volver a intentar sin esperar.
  await ctx.model("User").updateOne({ email }, { $unset: { lastHashSentAt: 1 } });
  const down = await withMailDown(() => ctx.raw("POST", "/auth/resend-code", { email }, { "x-forwarded-for": freshIp() }));
  assert.equal(down.status, 503);
  assert.equal(down.body.code, undefined);
  assert.equal((await ctx.model("User").findOne({ email }).lean()).lastHashSentAt ?? null, null);

  // Con el correo en marcha, el alta normal dice que sí salió.
  const ok = await ctx.raw("POST", "/users", { user: { name: "Bien", lastname: "Correo", email: `ok.${email}`, password: PASSWORD } });
  assert.equal(ok.body.verificationMailSent, true);
});

test("alta de profesional con el correo caído: 201 con la cuenta creada y el aviso interno de registro sale igual", async () => {
  const email = `pro.caido.${Date.now()}@example.test`;
  const before = ctx.sentMail.filter((m) => m.fn === "notifyUserRegistered").length;
  const created = await withMailDown(() => ctx.raw("POST", "/users/professional", { name: "Pro", lastname: "Caído", email, password: PASSWORD }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.verificationMailSent, false);
  assert.ok(await ctx.model("User").exists({ email }));
  assert.equal(ctx.sentMail.filter((m) => m.fn === "notifyUserRegistered").length, before + 1);
});

test("profesional sin verificar que entra: el código le llega con el asunto de Trainers", async () => {
  const trainer = await ctx.makeTrainer({ password: PASSWORD, fields: { hash: "111111" } });
  const res = await login(trainer.email, PASSWORD, h.FAMILY.trainer);
  assert.equal(res.status, 403);
  assert.equal(res.body.code, "ACCOUNT_NOT_VERIFIED");
  assert.equal(res.body.verificationMailSent, true);
  const sent = ctx.sentMail.at(-1);
  assert.equal(sent.args[0], trainer.email);
  assert.match(sent.args[1], /TrainFit Entrenadores/);

  // Y si el correo no sale, el login lo dice en vez de responder 500.
  const down = await withMailDown(() => login(trainer.email, PASSWORD, h.FAMILY.trainer));
  assert.equal(down.status, 403);
  assert.equal(down.body.verificationMailSent, false);
});

test("comprobar email (público): existe / no existe / registro social incompleto cuenta como libre", async () => {
  const user = await ctx.makeClient();
  assert.deepEqual((await ctx.raw("GET", `/users/check/${encodeURIComponent(user.email.toUpperCase())}`)).body, { emailExist: true });
  assert.deepEqual((await ctx.raw("GET", "/users/check/libre.total@example.test")).body, { emailExist: false });
  await ctx.model("User").create({ email: "social.incompleto@example.test", roles: ["user"], provider: "google" });
  assert.deepEqual((await ctx.raw("GET", "/users/check/social.incompleto@example.test")).body, { emailExist: false });
});

test("suplantación: el admin entra como el usuario, la sesión se marca y al revertir vuelve a la suya", async () => {
  const admin = await ctx.makeUser({ roles: ["admin", "user"], family: h.FAMILY.admin });
  const target = await ctx.makeClient();

  const asUser = await ctx.call(admin, "POST", "/auth/impersonate", { userId: target.id });
  assert.equal(asUser.status, 200, JSON.stringify(asUser.body));
  assert.equal(asUser.body.is_impersonating, true);
  const impersonated = withAccess(asUser.body, h.FAMILY.admin);
  const me = await ctx.call(impersonated, "GET", "/auth/me");
  assert.equal(String(me.body.user._id), target.id);
  assert.equal(me.body.is_impersonating, true);

  // La sesión real del usuario suplantado queda sustituida (una sesión por cuenta).
  assert.equal((await ctx.call(target, "GET", "/auth/me")).status, 401);

  const back = await ctx.call(impersonated, "POST", "/auth/impersonate/revert");
  assert.equal(back.status, 200, JSON.stringify(back.body));
  assert.equal(String(back.body.user._id), admin.id);
  assert.equal(back.body.is_impersonating, false);
  assert.equal((await ctx.call(impersonated, "GET", "/auth/me")).status, 401, "el token suplantado muere al revertir");

  // Revertir sin suplantación activa: 400.
  const adminAgain = withAccess(back.body, h.FAMILY.admin);
  assert.equal((await ctx.call(adminAgain, "POST", "/auth/impersonate/revert")).status, 400);
});

test("suplantar: solo admin", async () => {
  const user = await ctx.makeClient();
  const other = await ctx.makeClient();
  assert.equal((await ctx.call(user, "POST", "/auth/impersonate", { userId: other.id })).status, 403);
});


// QA 2026-10-09: errores del alta y de rol sin código (la app en inglés los
// enseñaba en español tal cual) y el 403 de rol en inglés.
test("errores con código: correo que no existe al darse de alta y 403 de rol", async () => {
  const original = mail.validateEmailExists;
  mail.validateEmailExists = async () => false;
  try {
    const res = await ctx.raw("POST", "/users", { user: { name: "X", lastname: "Y", email: "nadie@dominio-inexistente.test", password: PASSWORD } });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, "EMAIL_NOT_DELIVERABLE");
  } finally {
    mail.validateEmailExists = original;
  }

  const client = await ctx.makeClient();
  const forbidden = await ctx.call(client, "GET", "/trainer/alerts", undefined, { family: h.FAMILY.client });
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.code, "ROLE_FORBIDDEN");
  assert.doesNotMatch(forbidden.body.message, /You don't/);
});
