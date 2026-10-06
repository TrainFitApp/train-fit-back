// Tests del flujo completo de códigos de verificación de signup (campo
// `hash` + `hashExpiresAt`/`hashFailedAttempts`/`lastHashSentAt`).
//
// No hay conexión a MongoDB en estos tests: userSchema.findOne /
// findOneAndUpdate / findByIdAndUpdate se sustituyen por un "fake mongo" en
// memoria que sí aplica los filtros (incluido el $or del cooldown) y los
// operadores de update ($set/$unset/$inc) de verdad, para poder probar la
// atomicidad de la invalidación y la protección de condición de carrera del
// reenvío sin necesidad de una BD real.
const test = require("node:test");
const assert = require("node:assert/strict");

const userSchema = require("./user-schema");
const userDao = require("./user-dao");
const userService = require("./user-service");

// El código lo genera el servicio: se lee del "fake mongo" tras reenviar.
async function resend(store) {
  await userService.resendVerificationCode("test@example.com");
  return store.getDoc().hash;
}
const verify = (code) => userService.verifyActivationCode("test@example.com", code);
const mail = require("../util/mail");

function matchesFilter(doc, filter) {
  return Object.entries(filter).every(([key, cond]) => {
    if (key === "$or") {
      return cond.some((sub) => matchesFilter(doc, sub));
    }
    if (key === "_id") {
      return String(doc._id) === String(cond);
    }
    if (cond === null) {
      return doc[key] === null;
    }
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("$exists" in cond) {
        const has = doc[key] !== undefined;
        return has === cond.$exists;
      }
      if ("$lte" in cond) {
        return doc[key] != null && doc[key].getTime() <= cond.$lte.getTime();
      }
      return doc[key] === cond;
    }
    return doc[key] === cond;
  });
}

function applyUpdate(doc, update) {
  if (update.$set) {
    Object.assign(doc, update.$set);
  }
  if (update.$unset) {
    for (const key of Object.keys(update.$unset)) {
      delete doc[key];
    }
  }
  if (update.$inc) {
    for (const [key, amount] of Object.entries(update.$inc)) {
      doc[key] = (doc[key] || 0) + amount;
    }
  }
}

function queryResult(doc) {
  const query = {
    select: () => query,
    lean: () => query,
    then: (resolve, reject) => Promise.resolve(doc ? { ...doc } : null).then(resolve, reject),
  };
  return query;
}

function installFakeUserStore(initialDoc) {
  const doc = { ...initialDoc };

  const originalFindOne = userSchema.findOne;
  const originalFindOneAndUpdate = userSchema.findOneAndUpdate;
  const originalFindByIdAndUpdate = userSchema.findByIdAndUpdate;
  const originalUpdateOne = userSchema.updateOne;
  const originalValidateEmailExists = mail.validateEmailExists;
  const originalSendMailSES = mail.sendTransactionalMail;
  const originalGenerateHashMail = mail.generateHashMail;

  const sentEmails = [];

  userSchema.findOne = (filter) => queryResult(matchesFilter(doc, filter) ? doc : null);

  userSchema.findOneAndUpdate = async (filter, update) => {
    if (!matchesFilter(doc, filter)) return null;
    applyUpdate(doc, update);
    return { ...doc };
  };

  userSchema.findByIdAndUpdate = async (id, update) => {
    if (String(doc._id) !== String(id)) return null;
    applyUpdate(doc, update);
    return { ...doc };
  };

  userSchema.updateOne = async (filter, update) => {
    if (!matchesFilter(doc, filter)) return { matchedCount: 0 };
    applyUpdate(doc, update);
    return { matchedCount: 1 };
  };

  mail.validateEmailExists = async () => true;
  mail.sendTransactionalMail = async (email, subject, html) => {
    sentEmails.push({ email, subject, html });
  };
  mail.generateHashMail = (header1, description, hash) => `<html>${hash}</html>`;

  return {
    getDoc: () => ({ ...doc }),
    // Muta el doc interno directamente (getDoc() devuelve una copia). Se usa
    // en los tests para simular el paso del tiempo (p.ej. que ya pasó el
    // cooldown de 60s) sin depender de temporizadores reales.
    mutate: (partial) => Object.assign(doc, partial),
    sentEmails,
    restore: () => {
      userSchema.findOne = originalFindOne;
      userSchema.findOneAndUpdate = originalFindOneAndUpdate;
      userSchema.findByIdAndUpdate = originalFindByIdAndUpdate;
      userSchema.updateOne = originalUpdateOne;
      mail.validateEmailExists = originalValidateEmailExists;
      mail.sendTransactionalMail = originalSendMailSES;
      mail.generateHashMail = originalGenerateHashMail;
    },
  };
}

function baseUser(overrides = {}) {
  return {
    _id: "user1",
    email: "test@example.com",
    name: "Test",
    hash: "111111",
    hashExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    hashFailedAttempts: 0,
    lastHashSentAt: new Date(Date.now() - 61 * 1000),
    ...overrides,
  };
}

test("caso 1: el primer código funciona", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "111111" }));
  t.after(store.restore);

  const activated = await verify("111111");
  assert.equal(activated.hash, undefined);
});

test("caso 2 y 3: reenviar genera un código nuevo y el anterior deja de servir", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "111111" }));
  t.after(store.restore);

  const code = await resend(store);
  assert.notEqual(code, "111111");

  await assert.rejects(() => verify("111111"), (err) => err.code === "INVALID_CODE");

  const activated = await verify(code);
  assert.equal(activated.hash, undefined);
});

test("caso 3b: dos reenvíos seguidos, solo el último código sirve", async (t) => {
  const store = installFakeUserStore(
    baseUser({ hash: "111111", lastHashSentAt: new Date(Date.now() - 120 * 1000) }),
  );
  t.after(store.restore);

  const middle = await resend(store);

  // Simula que pasó el cooldown de 60s antes del segundo reenvío.
  store.mutate({ lastHashSentAt: new Date(Date.now() - 120 * 1000) });
  const last = await resend(store);

  await assert.rejects(() => verify("111111"));
  // El código intermedio también queda invalidado por el último reenvío.
  if (middle !== last) await assert.rejects(() => verify(middle));
  assert.ok(await verify(last));
});

test("caso 5: reenvíos rápidos consecutivos están protegidos por cooldown atómico", async (t) => {
  const store = installFakeUserStore(
    baseUser({ hash: "111111", lastHashSentAt: new Date() }), // recién enviado
  );
  t.after(store.restore);

  await assert.rejects(
    () => userService.resendVerificationCode("test@example.com"),
    (err) => err.code === "COOLDOWN_ACTIVE",
  );

  // El código original sigue siendo el válido: el reenvío bloqueado no debe
  // haber tocado la BD ni haber enviado el email.
  assert.equal(store.getDoc().hash, "111111");
  assert.equal(store.sentEmails.length, 0);
});

test("caso 6: código expirado falla aunque sea el último enviado", async (t) => {
  const store = installFakeUserStore(
    baseUser({ hash: "111111", hashExpiresAt: new Date(Date.now() - 1000) }),
  );
  t.after(store.restore);

  await assert.rejects(
    () => verify("111111"),
    (err) => err.code === "CODE_EXPIRED",
  );
});

test("caso 7: un código válido verifica correctamente al usuario", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "654321" }));
  t.after(store.restore);

  const activated = await verify("654321");
  assert.equal(activated._id, "user1");
  assert.equal(activated.hash, undefined);
  assert.equal(activated.hashExpiresAt, undefined);
  assert.equal(activated.hashFailedAttempts, undefined);
});

test("caso 8: reutilizar un código ya usado falla", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "654321" }));
  t.after(store.restore);

  await verify("654321");

  await assert.rejects(
    () => verify("654321"),
    (err) => err.code === "ALREADY_VERIFIED",
  );
});

test("caso 9: reenviar después de verificar con éxito no genera un hash fantasma", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "654321" }));
  t.after(store.restore);

  await verify("654321");

  await assert.rejects(
    () => userService.resendVerificationCode("test@example.com"),
    (err) => err.code === "ALREADY_VERIFIED",
  );
  assert.equal(store.sentEmails.length, 0);
});

test("caso 10: la fuente de verdad es la BD, no el estado en memoria del cliente", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "777777" }));
  t.after(store.restore);

  // Dos llamadas independientes (equivalente a cerrar/reabrir la app) deben
  // leer siempre el estado actual de la BD, no un valor cacheado.
  const first = await verify("wrong-code".slice(0, 6)).catch((e) => e);
  assert.ok(first instanceof Error);

  const activated = await verify("777777");
  assert.equal(activated.hash, undefined);
});

test("intentos fallidos: se bloquea tras 5 intentos incorrectos", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "111111", hashFailedAttempts: 0 }));
  t.after(store.restore);

  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () => verify("000000"),
      (err) => err.code === "INVALID_CODE",
    );
  }

  assert.equal(store.getDoc().hashFailedAttempts, 5);

  await assert.rejects(
    () => verify("111111"),
    (err) => err.code === "TOO_MANY_ATTEMPTS",
  );
});

test("resendVerificationCode reinicia los intentos fallidos del código anterior", async (t) => {
  const store = installFakeUserStore(
    baseUser({ hash: "111111", hashFailedAttempts: 3, lastHashSentAt: new Date(Date.now() - 120 * 1000) }),
  );
  t.after(store.restore);

  await resend(store);
  assert.equal(store.getDoc().hashFailedAttempts, 0);
});

test("updateVerificationHash (regeneración desde login) también fija expiración y resetea intentos", async (t) => {
  const store = installFakeUserStore(baseUser({ hash: "111111", hashFailedAttempts: 4 }));
  t.after(store.restore);

  const newExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const updated = await userDao.updateVerificationHash("user1", "888888", newExpiresAt);

  assert.equal(updated.hash, "888888");
  assert.equal(updated.hashFailedAttempts, 0);
  assert.equal(updated.hashExpiresAt.getTime(), newExpiresAt.getTime());
});

test("resendVerificationCode envía por email exactamente el código guardado en BD", async (t) => {
  const store = installFakeUserStore(
    baseUser({ hash: "111111", lastHashSentAt: new Date(Date.now() - 120 * 1000) }),
  );
  t.after(store.restore);

  const code = await resend(store);

  assert.equal(store.sentEmails.length, 1);
  assert.match(store.sentEmails[0].html, new RegExp(code));
  assert.notEqual(code, "111111");
});
