const test = require("node:test");
const assert = require("node:assert/strict");
const { contentCycleDays, windowsUntil, windowAt, nextWindow, DEFAULT_CYCLE_DAYS } = require("./cycle-window");

// Ciclos por contenido: el ciclo N no existe en la base de datos, es
// aritmética encadenada desde el head. Si esto se equivoca en un día, la
// ficha del entrenador enseña un "ciclo actual" que no es, y el ciclo
// preparado se guarda con la fecha equivocada.

const seq = (startDate, nDays, extra = {}) => ({
  _id: `${startDate}-${nDays}`,
  startDate,
  mode: "sequential",
  days: Array.from({ length: nDays }, (_, i) => ({ dayLabel: `Día ${i + 1}` })),
  ...extra,
});

test("contentCycleDays", async (t) => {
  await t.test("sequential = número de días", () => {
    assert.equal(contentCycleDays(seq("2026-09-12", 3)), 3);
    assert.equal(contentCycleDays(seq("2026-09-12", 1)), 1);
  });
  await t.test("recurring = semana", () => {
    assert.equal(contentCycleDays({ mode: "recurring", days: [] }), 7);
  });
  await t.test("choice = choiceCycleDays, con fallback", () => {
    assert.equal(contentCycleDays({ mode: "choice", choiceCycleDays: 4 }), 4);
    assert.equal(contentCycleDays({ mode: "choice" }), DEFAULT_CYCLE_DAYS);
    assert.equal(contentCycleDays({ mode: "choice", choiceCycleDays: 0 }), DEFAULT_CYCLE_DAYS);
  });
  await t.test("sequential sin días no da un ciclo de 0", () => {
    assert.equal(contentCycleDays({ mode: "sequential", days: [] }), DEFAULT_CYCLE_DAYS);
  });
});

test("windowsUntil — ciclos encadenados con un solo persistido", async (t) => {
  const cycles = [seq("2026-09-12", 3)];

  await t.test("C1 arranca en el head y mide sus días", () => {
    const [c1] = windowsUntil(cycles, "2026-09-12");
    assert.deepEqual(
      { number: c1.number, start: c1.start, end: c1.end, len: c1.len },
      { number: 1, start: "2026-09-12", end: "2026-09-14", len: 3 }
    );
    assert.equal(c1.override, cycles[0]);
  });

  await t.test("el ejemplo del entrenador: 12-14, 15-17, 18-20", () => {
    const w = windowsUntil(cycles, "2026-09-19").map((x) => [x.number, x.start, x.end]);
    assert.deepEqual(w, [
      [1, "2026-09-12", "2026-09-14"],
      [2, "2026-09-15", "2026-09-17"],
      [3, "2026-09-18", "2026-09-20"],
    ]);
  });

  await t.test("último día de la ventana sigue en ella", () => {
    assert.equal(windowAt(cycles, "2026-09-14").number, 1);
    assert.equal(windowAt(cycles, "2026-09-15").number, 2);
  });

  await t.test("antes del inicio de la fase → C1", () => {
    const w = windowsUntil(cycles, "2026-09-01");
    assert.equal(w.length, 1);
    assert.equal(w[0].number, 1);
  });

  await t.test("ciclo de 1 día: cada día es un ciclo", () => {
    const one = [seq("2026-09-12", 1)];
    assert.equal(windowAt(one, "2026-09-12").number, 1);
    assert.equal(windowAt(one, "2026-09-13").number, 2);
    assert.deepEqual(
      [windowAt(one, "2026-09-13").start, windowAt(one, "2026-09-13").end],
      ["2026-09-13", "2026-09-13"]
    );
  });

  await t.test("cruza fin de mes y de año sin perder días", () => {
    const w = windowAt([seq("2026-12-28", 7)], "2027-01-05");
    assert.deepEqual([w.number, w.start, w.end], [2, "2027-01-04", "2027-01-10"]);
  });
});

test("windowsUntil — un ciclo preparado cambia el paso de los siguientes", async (t) => {
  // C1 de 3 días desde el 12; el entrenador prepara C3 (empieza el 18) con 5 días.
  const cycles = [seq("2026-09-12", 3), seq("2026-09-18", 5)];

  await t.test("C1 y C2 miden 3, C3 en adelante miden 5", () => {
    const w = windowsUntil(cycles, "2026-09-30").map((x) => [x.number, x.start, x.end, x.len]);
    assert.deepEqual(w, [
      [1, "2026-09-12", "2026-09-14", 3],
      [2, "2026-09-15", "2026-09-17", 3],
      [3, "2026-09-18", "2026-09-22", 5],
      [4, "2026-09-23", "2026-09-27", 5],
      [5, "2026-09-28", "2026-10-02", 5],
    ]);
  });

  await t.test("C2 hereda del head, C3+ del preparado", () => {
    const w = windowsUntil(cycles, "2026-09-25");
    assert.equal(w[1].override, cycles[0]);
    assert.equal(w[2].override, cycles[1]);
    assert.equal(w[3].override, cycles[1]);
  });
});

test("nextWindow", async (t) => {
  await t.test("empieza el día después y mide lo que rige entonces", () => {
    const cycles = [seq("2026-09-12", 3), seq("2026-09-18", 5)];
    const c2 = windowAt(cycles, "2026-09-16");
    const c3 = nextWindow(cycles, c2);
    assert.deepEqual([c3.number, c3.start, c3.end, c3.len], [3, "2026-09-18", "2026-09-22", 5]);
    assert.equal(c3.override, cycles[1]);
  });

  await t.test("sin persistido posterior, hereda el vigente", () => {
    const cycles = [seq("2026-09-12", 3)];
    const c1 = windowAt(cycles, "2026-09-12");
    const c2 = nextWindow(cycles, c1);
    assert.deepEqual([c2.number, c2.start, c2.end], [2, "2026-09-15", "2026-09-17"]);
    assert.equal(c2.override, cycles[0]);
  });
});

test("head sin startDate → sin ventanas, sin bucle", () => {
  assert.deepEqual(windowsUntil([{ mode: "sequential", days: [{}] }], "2026-09-12"), []);
  assert.equal(windowAt([], "2026-09-12"), null);
});
