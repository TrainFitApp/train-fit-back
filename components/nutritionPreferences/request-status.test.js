const test = require("node:test");
const assert = require("node:assert/strict");
const { isRequestPending } = require("./request-status");

test("isRequestPending", async (t) => {
  await t.test("sin documento o sin solicitud no hay pendiente", () => {
    assert.equal(isRequestPending(null), false);
    assert.equal(isRequestPending({ respondedAt: new Date("2026-09-01") }), false);
  });

  await t.test("solicitada y nunca respondida", () => {
    assert.equal(isRequestPending({ requestedAt: new Date("2026-09-01"), respondedAt: null }), true);
  });

  await t.test("solicitada después de responder (intake o entrenador ya respondieron)", () => {
    assert.equal(
      isRequestPending({ requestedAt: new Date("2026-09-20"), respondedAt: new Date("2026-09-01") }),
      true
    );
  });

  await t.test("respondida después de la solicitud", () => {
    assert.equal(
      isRequestPending({ requestedAt: new Date("2026-09-20"), respondedAt: new Date("2026-09-21") }),
      false
    );
  });

  await t.test("acepta fechas serializadas", () => {
    assert.equal(
      isRequestPending({ requestedAt: "2026-09-20T10:00:00.000Z", respondedAt: "2026-09-20T09:00:00.000Z" }),
      true
    );
  });
});
