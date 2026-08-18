const test = require("node:test");
const assert = require("node:assert/strict");
const setSchema = require("./set-schema");
const setDao = require("./set-dao");

// setSchema.findById/findByIdAndUpdate se sustituyen temporalmente por
// stubs — no hay conexión a MongoDB en estos tests, solo se comprueba la
// lógica de donedAt en set-dao.js#updateSet (nunca confiar en el cliente,
// solo fijarlo en la transición real false->true).
async function withMockedSet(currentDoc, run) {
  const originalFindById = setSchema.findById;
  const originalFindByIdAndUpdate = setSchema.findByIdAndUpdate;
  let capturedUpdate = null;

  setSchema.findById = () => ({
    select: async () => currentDoc,
  });
  setSchema.findByIdAndUpdate = async (id, update) => {
    capturedUpdate = update;
    return { _id: id, ...(update.$set || {}) };
  };

  try {
    await run();
    return capturedUpdate;
  } finally {
    setSchema.findById = originalFindById;
    setSchema.findByIdAndUpdate = originalFindByIdAndUpdate;
  }
}

test("set-dao updateSet — donedAt", async (t) => {
  await t.test("false -> true: fija donedAt", async () => {
    const update = await withMockedSet({ doned: false }, () =>
      setDao.updateSet({ _id: "s1", doned: true, weight: 100 }),
    );
    assert.ok(update.$set.donedAt instanceof Date);
  });

  await t.test("true -> true (edición no relacionada): NO vuelve a tocar donedAt", async () => {
    const update = await withMockedSet({ doned: true }, () =>
      setDao.updateSet({ _id: "s1", doned: true, weight: 105 }),
    );
    assert.equal(update.$set.donedAt, undefined);
  });

  await t.test("true -> false: limpia donedAt", async () => {
    const update = await withMockedSet({ doned: true }, () =>
      setDao.updateSet({ _id: "s1", doned: false }),
    );
    assert.equal(update.$unset.donedAt, "");
  });

  await t.test("el cliente no puede mandar donedAt directamente", async () => {
    const fakeDate = new Date("2020-01-01");
    const update = await withMockedSet({ doned: true }, () =>
      setDao.updateSet({ _id: "s1", doned: true, donedAt: fakeDate, weight: 90 }),
    );
    assert.notEqual(update.$set.donedAt, fakeDate);
    assert.equal(update.$set.donedAt, undefined);
  });
});
