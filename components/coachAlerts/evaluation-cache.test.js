const test = require("node:test");
const assert = require("node:assert/strict");
const cache = require("./evaluation-cache");

// Cuándo se reutiliza la evaluación de alertas de un profesional (QA
// 2026-10-09, M9: valía el día entero).

const T0 = Date.parse("2026-10-09T09:00:00Z");
const put = (trainerId, entry) => cache.evaluations.set(String(trainerId), { promise: Promise.resolve(), ...entry });

test("reutiliza la de hoy si es reciente; caducada o de otro día, no", () => {
  cache.evaluations.clear();
  put("t1", { day: "2026-10-09", startedAt: T0, pending: false });
  assert.ok(cache.reusable("t1", "2026-10-09", T0 + 60 * 1000));
  assert.equal(cache.reusable("t1", "2026-10-09", T0 + cache.FRESH_MS), null, "caducada");
  assert.equal(cache.reusable("t1", "2026-10-10", T0 + 1000), null, "otro día");
  assert.equal(cache.reusable("otro", "2026-10-09", T0), null);
});

test("una en curso siempre se reutiliza (no se lanzan dos a la vez)", () => {
  cache.evaluations.clear();
  put("t1", { day: "2026-10-08", startedAt: T0 - cache.FRESH_MS * 10, pending: true });
  assert.ok(cache.reusable("t1", "2026-10-09", T0));
});

test("invalidar borra la terminada y marca la que está en curso", () => {
  cache.evaluations.clear();
  put("t1", { day: "2026-10-09", startedAt: T0, pending: false });
  cache.invalidate("t1");
  assert.equal(cache.reusable("t1", "2026-10-09", T0), null);

  put("t2", { day: "2026-10-09", startedAt: T0, pending: true });
  cache.invalidate("t2");
  assert.equal(cache.evaluations.get("t2").stale, true);
});
