// Tests del flujo de reenvío de código de "restaurar contraseña" (campo
// `restoreCode`). El usuario reportó que, igual que en signup, el código
// anterior seguía siendo válido tras un reenvío. La auditoría encontró que
// aquí no había mismatch de campos/endpoints (a diferencia de signup), sino:
//   1) dao.js#sendMailCode hacía cooldown check + escritura en pasos
//      separados (no atómico), y
//   2) controller.js#sendMailCode tragaba el error de cooldown/límite
//      diario y siempre respondía 200, así que un reenvío bloqueado por el
//      servidor parecía "exitoso" para el frontend aunque restoreCode no
//      hubiese cambiado.
// Estos tests cubren ambas capas con el mismo patrón de "fake mongo" en
// memoria usado en verification-flow.test.js (sin conexión real a BD).
const test = require("node:test");
const assert = require("node:assert/strict");

const userSchema = require("./schema");
const userDao = require("./dao");
const userModel = require("./model");
const controller = require("./controller");
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
  if (update.$set) Object.assign(doc, update.$set);
  if (update.$unset) for (const key of Object.keys(update.$unset)) delete doc[key];
  if (update.$inc) for (const [key, amount] of Object.entries(update.$inc)) doc[key] = (doc[key] || 0) + amount;
}

function queryResult(doc) {
  return {
    select: async () => (doc ? { ...doc } : null),
    then: (resolve, reject) => Promise.resolve(doc ? { ...doc } : null).then(resolve, reject),
  };
}

function installFakeUserStore(initialDoc) {
  const doc = { ...initialDoc };

  const original = {
    findOne: userSchema.findOne,
    findOneAndUpdate: userSchema.findOneAndUpdate,
    findByIdAndUpdate: userSchema.findByIdAndUpdate,
    validateEmailExists: mail.validateEmailExists,
    sendMailSES: mail.sendMailSES,
    generateHashMail: mail.generateHashMail,
  };

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
  mail.validateEmailExists = async () => true;
  mail.sendMailSES = async (email, subject, html) => {
    sentEmails.push({ email, subject, html });
  };
  mail.generateHashMail = (header1, description, hash) => `<html>${hash}</html>`;

  return {
    getDoc: () => ({ ...doc }),
    mutate: (partial) => Object.assign(doc, partial),
    sentEmails,
    restore: () => {
      userSchema.findOne = original.findOne;
      userSchema.findOneAndUpdate = original.findOneAndUpdate;
      userSchema.findByIdAndUpdate = original.findByIdAndUpdate;
      mail.validateEmailExists = original.validateEmailExists;
      mail.sendMailSES = original.sendMailSES;
      mail.generateHashMail = original.generateHashMail;
    },
  };
}

function baseUser(overrides = {}) {
  return {
    _id: "user1",
    email: "test@example.com",
    restoreCode: undefined,
    restoreCodeExpiresAt: undefined,
    restoreFailedAttempts: 0,
    lastRestoreCodeSentAt: new Date(Date.now() - 61 * 1000),
    restoreCodeDate: undefined,
    restoreCodeDailyCount: 0,
    ...overrides,
  };
}

function fakeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    send(body) {
      res.body = body;
      return res;
    },
  };
  return res;
}

test("dao.sendMailCode sobrescribe restoreCode de forma atómica en cada reenvío", async (t) => {
  const store = installFakeUserStore(baseUser({ restoreCode: "aaa111" }));
  t.after(store.restore);

  await userDao.sendMailCode("test@example.com", "bbb222", new Date(Date.now() + 15 * 60 * 1000));
  assert.equal(store.getDoc().restoreCode, "bbb222");
});

test("dao.sendMailCode: reenvío dentro del cooldown no toca la BD ni envía email (protección atómica)", async (t) => {
  const store = installFakeUserStore(
    baseUser({ restoreCode: "aaa111", lastRestoreCodeSentAt: new Date() }),
  );
  t.after(store.restore);

  await assert.rejects(
    () => userDao.sendMailCode("test@example.com", "bbb222", new Date(Date.now() + 15 * 60 * 1000)),
    (err) => err.message === "COOLDOWN_ACTIVE",
  );

  assert.equal(store.getDoc().restoreCode, "aaa111");
  assert.equal(store.sentEmails.length, 0);
});

test("dao.sendMailCode: el límite diario de 3 códigos ahora sí se aplica (antes el select() no traía los campos y nunca se alcanzaba)", async (t) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const store = installFakeUserStore(
    baseUser({
      restoreCode: "aaa111",
      lastRestoreCodeSentAt: new Date(Date.now() - 120 * 1000),
      restoreCodeDate: today,
      restoreCodeDailyCount: 3,
    }),
  );
  t.after(store.restore);

  await assert.rejects(
    () => userDao.sendMailCode("test@example.com", "bbb222", new Date(Date.now() + 15 * 60 * 1000)),
    (err) => err.message === "DAILY_LIMIT_REACHED",
  );
  assert.equal(store.getDoc().restoreCode, "aaa111");
});

test("dao.sendMailCode: un nuevo día resetea el contador diario", async (t) => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(0, 0, 0, 0);
  const store = installFakeUserStore(
    baseUser({
      restoreCode: "aaa111",
      lastRestoreCodeSentAt: new Date(Date.now() - 120 * 1000),
      restoreCodeDate: yesterday,
      restoreCodeDailyCount: 3,
    }),
  );
  t.after(store.restore);

  await userDao.sendMailCode("test@example.com", "bbb222", new Date(Date.now() + 15 * 60 * 1000));
  assert.equal(store.getDoc().restoreCode, "bbb222");
  assert.equal(store.getDoc().restoreCodeDailyCount, 1);
});

test("dao.sendMailCode: dos reenvíos consecutivos (con cooldown ya pasado) — solo el último restoreCode es válido", async (t) => {
  const store = installFakeUserStore(
    baseUser({ restoreCode: "aaa111", lastRestoreCodeSentAt: new Date(Date.now() - 120 * 1000) }),
  );
  t.after(store.restore);

  await userDao.sendMailCode("test@example.com", "bbb222", new Date(Date.now() + 15 * 60 * 1000));
  store.mutate({ lastRestoreCodeSentAt: new Date(Date.now() - 120 * 1000) });
  await userDao.sendMailCode("test@example.com", "ccc333", new Date(Date.now() + 15 * 60 * 1000));

  assert.equal(store.getDoc().restoreCode, "ccc333");
  assert.notEqual(store.getDoc().restoreCode, "bbb222");
  assert.notEqual(store.getDoc().restoreCode, "aaa111");
});

test("controller.sendMailCode: cooldown activo devuelve 429 explícito (antes devolvía 200 silenciosamente)", async (t) => {
  const store = installFakeUserStore(
    baseUser({ restoreCode: "aaa111", lastRestoreCodeSentAt: new Date() }),
  );
  t.after(store.restore);

  const res = fakeRes();
  await controller.sendMailCode({ params: { email: "test@example.com" } }, res);

  assert.equal(res.statusCode, 429);
  assert.match(res.body.message, /segundos/i);
  assert.equal(store.getDoc().restoreCode, "aaa111");
});

test("controller.sendMailCode: éxito real devuelve 200 y cambia el código", async (t) => {
  const store = installFakeUserStore(
    baseUser({ restoreCode: "aaa111", lastRestoreCodeSentAt: new Date(Date.now() - 120 * 1000) }),
  );
  t.after(store.restore);

  const res = fakeRes();
  await controller.sendMailCode({ params: { email: "test@example.com" } }, res);

  assert.equal(res.statusCode, 200);
  assert.notEqual(store.getDoc().restoreCode, "aaa111");
});

test("controller.sendMailCode: usuario inexistente devuelve 200 genérico (anti-enumeración, comportamiento preservado)", async (t) => {
  const originalFindOne = userSchema.findOne;
  const originalValidate = mail.validateEmailExists;
  userSchema.findOne = () => queryResult(null);
  mail.validateEmailExists = async () => true;
  t.after(() => {
    userSchema.findOne = originalFindOne;
    mail.validateEmailExists = originalValidate;
  });

  const res = fakeRes();
  await controller.sendMailCode({ params: { email: "noexiste@example.com" } }, res);

  assert.equal(res.statusCode, 200);
});
