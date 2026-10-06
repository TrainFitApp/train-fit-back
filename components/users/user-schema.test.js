// Estos tests no necesitan conexión a MongoDB: `new Model()` + `validateSync()`
// corren en memoria, y `Query.prototype.cast()`/el helper interno de Mongoose
// `castUpdate` aplican el mismo casting de schema (trim/lowercase) que se
// ejecuta antes de tocar la BD real en find/findOne/findOneAndUpdate/exists.
const test = require("node:test");
const assert = require("node:assert/strict");
// mongoose debe cargarse (e inicializar su driver) antes de tocar sus
// helpers internos, o castUpdate revienta al resolver el driver.
require("mongoose");
const User = require("./schema");
const castUpdate = require("mongoose/lib/helpers/query/castUpdate");

test("email field casing/whitespace (signup)", async (t) => {
  await t.test("uppercase email is normalized on document construction", () => {
    const doc = new User({ email: "David.Argente@Gmail.COM", name: "David" });
    assert.equal(doc.email, "david.argente@gmail.com");
  });

  await t.test("lowercase email is left unchanged", () => {
    const doc = new User({ email: "david.argente@gmail.com", name: "David" });
    assert.equal(doc.email, "david.argente@gmail.com");
  });

  await t.test("mixed-case email is normalized", () => {
    const doc = new User({ email: "DaViD.ArGeNtE@gMaIl.CoM", name: "David" });
    assert.equal(doc.email, "david.argente@gmail.com");
  });

  await t.test("leading/trailing spaces are trimmed", () => {
    const doc = new User({ email: "  David.Argente@Gmail.COM  ", name: "David" });
    assert.equal(doc.email, "david.argente@gmail.com");
  });

  await t.test("well-formed email passes validation", () => {
    const doc = new User({ email: "David.Argente@Gmail.COM", name: "David" });
    const err = doc.validateSync();
    assert.equal(err, undefined);
  });

  await t.test("malformed email fails validation", () => {
    const doc = new User({ email: "not-an-email", name: "David" });
    const err = doc.validateSync();
    assert.ok(err?.errors?.email);
  });
});

test("email query casting (login / lookups)", async (t) => {
  const variants = [
    "david.argente@gmail.com",
    "David.Argente@gmail.com",
    "DAVID.ARGENTE@GMAIL.COM",
    "DaViD.ArGeNtE@gMaIl.CoM",
    "  David.Argente@Gmail.com  ",
  ];

  for (const variant of variants) {
    await t.test(`find({email: ${JSON.stringify(variant)}}) casts to the canonical form`, () => {
      const q = User.find({ email: variant });
      const casted = q.cast(User, q._conditions);
      assert.equal(casted.email, "david.argente@gmail.com");
    });
  }

  await t.test("findOneAndUpdate filter is normalized the same way", () => {
    const q = User.findOneAndUpdate({ email: "David.Argente@GMAIL.com" }, { lastLogin: new Date() });
    const casted = q.cast(User, q._conditions);
    assert.equal(casted.email, "david.argente@gmail.com");
  });
});

test("email update-payload casting ($set.email)", async (t) => {
  await t.test("a $set.email update is normalized before hitting the DB", () => {
    const update = { $set: { email: "  New.Email@TEST.com  " } };
    const casted = castUpdate(User.schema, update, { strict: true, upsert: false }, User, {});
    assert.equal(casted.$set.email, "new.email@test.com");
  });
});
