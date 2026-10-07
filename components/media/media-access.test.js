const test = require("node:test");
const assert = require("node:assert/strict");
const { trainerCanSeeProgressDay, sentToTrainer } = require("./media-access");

// Quién ve las fotos y vídeos de progreso de un cliente (decisión 4 del
// plan): es la regla que protege lo más íntimo que guarda la app.

const TRAINER = "507f1f77bcf86cd799439011";
const OTHER = "507f1f77bcf86cd799439012";
const RELATION = { trainerId: TRAINER, relationStart: new Date("2026-09-01T10:00:00Z"), historyShared: false, timeZone: "Europe/Madrid" };

test("días del cliente desde que empezó la relación: visibles salvo que los oculte", () => {
  assert.equal(trainerCanSeeProgressDay({ date: "2026-09-10" }, RELATION), true);
  assert.equal(trainerCanSeeProgressDay({ date: "2026-09-10", hiddenFromTrainers: true }, RELATION), false);
});

test("días anteriores a la relación: solo con el historial compartido", () => {
  assert.equal(trainerCanSeeProgressDay({ date: "2026-08-20" }, RELATION), false);
  assert.equal(trainerCanSeeProgressDay({ date: "2026-08-20" }, { ...RELATION, historyShared: true }), true);
});

test("lo mandado en un check-in o en el cuestionario de alta lo ve siempre quien lo pidió", async (t) => {
  await t.test("check-in: aunque esté oculto y sea anterior", () => {
    const day = { date: "2026-08-20", hiddenFromTrainers: true, checkins: [{ trainerId: TRAINER }] };
    assert.equal(trainerCanSeeProgressDay(day, RELATION), true);
  });

  await t.test("cuestionario de alta: aunque esté oculto", () => {
    const day = { date: "2026-09-02", hiddenFromTrainers: true, intakes: [{ trainerId: TRAINER }] };
    assert.equal(trainerCanSeeProgressDay(day, RELATION), true);
    assert.equal(sentToTrainer(day, TRAINER), true);
  });

  await t.test("pero no otro profesional", () => {
    const day = { date: "2026-09-02", hiddenFromTrainers: true, intakes: [{ trainerId: OTHER }], checkins: [{ trainerId: OTHER }] };
    assert.equal(trainerCanSeeProgressDay(day, RELATION), false);
    assert.equal(sentToTrainer(day, TRAINER), false);
  });

  await t.test("días sin esos campos (anteriores a ellos) no rompen la regla", () => {
    assert.equal(sentToTrainer({ date: "2026-09-02" }, TRAINER), false);
    assert.equal(sentToTrainer(null, TRAINER), false);
  });
});

test("sin relación o sin día, nada", () => {
  assert.equal(trainerCanSeeProgressDay(null, RELATION), false);
  assert.equal(trainerCanSeeProgressDay({ date: "2026-09-10" }, { ...RELATION, relationStart: null }), false);
});
