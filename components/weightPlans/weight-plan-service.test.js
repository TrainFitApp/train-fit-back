const test = require("node:test");
const assert = require("node:assert/strict");
const { complianceFor, reminderIsDue } = require("./weight-plan-service");

const plan = (extra = {}) => ({
  _id: "p1",
  intervalDays: 3,
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  lastReminderSentAt: null,
  ...extra,
});

const at = (iso) => new Date(iso);

test("cumplimiento de la pauta de peso", async (t) => {
  await t.test("al día si hay peso dentro de la ventana", () => {
    const c = complianceFor(plan(), { date: "2026-09-09", weight: 78.4 }, at("2026-09-10T08:00:00Z"));
    assert.equal(c.upToDate, true);
    assert.equal(c.overdueDays, 0);
    assert.equal(c.lastWeightKg, 78.4);
    assert.equal(c.neverWeighed, false);
  });

  // Pesarse el martes y mirarlo el jueves por la mañana con pauta de 2 días
  // no es incumplir: la ventana se ancla al final del día, no a las 00:00.
  await t.test("no cuenta el desfase de horas como retraso", () => {
    const c = complianceFor(
      plan({ intervalDays: 2 }),
      { date: "2026-09-08", weight: 80 },
      at("2026-09-10T09:00:00Z")
    );
    assert.equal(c.upToDate, true);
  });

  await t.test("atrasado cuando la ventana ha pasado", () => {
    const c = complianceFor(plan(), { date: "2026-09-09", weight: 78.4 }, at("2026-09-14T08:00:00Z"));
    assert.equal(c.upToDate, false);
    assert.equal(c.overdueDays, 1);
  });

  // Pesarse de más nunca puede salir peor que pesarse lo justo.
  await t.test("varios pesos seguidos no penalizan", () => {
    const c = complianceFor(plan(), { date: "2026-09-14", weight: 78 }, at("2026-09-14T20:00:00Z"));
    assert.equal(c.upToDate, true);
  });

  await t.test("una pauta recién puesta no nace atrasada", () => {
    const c = complianceFor(plan(), null, at("2026-09-02T10:00:00Z"));
    assert.equal(c.neverWeighed, true);
    assert.equal(c.upToDate, true);
    assert.equal(c.lastWeightAt, null);
  });

  await t.test("sin pesarse nunca, vence al cumplirse el intervalo", () => {
    const c = complianceFor(plan(), null, at("2026-09-06T10:00:00Z"));
    assert.equal(c.upToDate, false);
    assert.equal(c.overdueDays, 2);
  });

  await t.test("sin pauta no hay nada que calcular", () => {
    assert.equal(complianceFor(null, { date: "2026-09-09", weight: 78 }), null);
  });
});

test("aviso de pauta vencida", async (t) => {
  const vencida = (p = plan()) =>
    complianceFor(p, { date: "2026-09-09", weight: 78 }, at("2026-09-14T08:00:00Z"));

  await t.test("no avisa si está al día", () => {
    const c = complianceFor(plan(), { date: "2026-09-14", weight: 78 }, at("2026-09-14T08:00:00Z"));
    assert.equal(reminderIsDue(plan(), c, at("2026-09-14T08:00:00Z")), false);
  });

  await t.test("avisa la primera vez que vence", () => {
    assert.equal(reminderIsDue(plan(), vencida(), at("2026-09-14T08:00:00Z")), true);
  });

  // Un solo aviso por ventana: si no, el cron avisaría cada día que pasara.
  // La ventana de estos casos vence el 2026-09-12 a última hora.
  await t.test("no repite el aviso dentro de la misma ventana", () => {
    const yaAvisado = plan({ lastReminderSentAt: at("2026-09-13T09:00:00Z") });
    assert.equal(reminderIsDue(yaAvisado, vencida(yaAvisado), at("2026-09-14T08:00:00Z")), false);
  });

  await t.test("vuelve a avisar si el último aviso era de una ventana anterior", () => {
    const avisadoAntes = plan({ lastReminderSentAt: at("2026-09-10T09:00:00Z") });
    assert.equal(reminderIsDue(avisadoAntes, vencida(avisadoAntes), at("2026-09-14T08:00:00Z")), true);
  });
});
