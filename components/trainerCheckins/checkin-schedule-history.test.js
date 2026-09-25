const test = require("node:test");
const assert = require("node:assert/strict");
const { historyOccurrences } = require("./checkin-schedule-dates");

const diaria = { startDate: "2024-01-01", frequency: "daily", interval: 1 };
const HOY = "2026-09-21";

test("historyOccurrences — página más reciente", async (t) => {
  await t.test("devuelve de la más nueva a la más vieja", () => {
    const { occurrences } = historyOccurrences(diaria, { limit: 3, today: HOY });
    assert.deepEqual(
      occurrences.map((o) => o.date),
      ["2026-09-21", "2026-09-20", "2026-09-19"]
    );
  });

  await t.test("no enseña el futuro", () => {
    const { occurrences } = historyOccurrences(diaria, { limit: 1, today: HOY });
    assert.equal(occurrences[0].date, HOY);
  });

  await t.test("cuenta el total desde el principio de la programación", () => {
    // 2024-01-01 → 2026-09-21, ambos incluidos.
    const { total } = historyOccurrences(diaria, { limit: 1, today: HOY });
    assert.equal(total, 995);
  });
});

test("historyOccurrences — paginado hacia atrás", async (t) => {
  await t.test("el cursor es EXCLUSIVO", () => {
    const { occurrences } = historyOccurrences(diaria, { before: "2026-09-20", limit: 2, today: HOY });
    assert.deepEqual(
      occurrences.map((o) => o.date),
      ["2026-09-19", "2026-09-18"]
    );
  });

  await t.test("recorre toda la historia sin repetir ni saltarse nada", () => {
    // Una programación diaria de dos años y pico pasa del tope de 400 de
    // occurrenceDatesBetween: esta es la regresión que vigila el test.
    const vistas = [];
    let before = null;
    for (let pagina = 0; pagina < 50; pagina++) {
      const { occurrences, nextBefore } = historyOccurrences(diaria, { before, limit: 100, today: HOY });
      vistas.push(...occurrences.map((o) => o.date));
      if (!nextBefore) break;
      before = nextBefore;
    }
    assert.equal(vistas.length, 995);
    assert.equal(new Set(vistas).size, 995);
    assert.equal(vistas[0], HOY);
    assert.equal(vistas[vistas.length - 1], "2024-01-01");
  });

  await t.test("la última página no deja cursor", () => {
    const { nextBefore } = historyOccurrences(diaria, { before: "2024-01-03", limit: 100, today: HOY });
    assert.equal(nextBefore, null);
  });
});

test("historyOccurrences — cadencias", async (t) => {
  await t.test("semanal cada 2 semanas", () => {
    const quincenal = { startDate: "2026-09-07", frequency: "weekly", interval: 2 };
    const { occurrences, total } = historyOccurrences(quincenal, { limit: 5, today: HOY });
    assert.deepEqual(
      occurrences.map((o) => o.date),
      ["2026-09-21", "2026-09-07"]
    );
    assert.equal(total, 2);
  });

  await t.test("mensual desde un 31: el mes corto no se desborda", () => {
    const mensual = { startDate: "2026-01-31", frequency: "monthly", interval: 1 };
    const { occurrences } = historyOccurrences(mensual, { limit: 4, today: "2026-04-30" });
    assert.deepEqual(
      occurrences.map((o) => o.date),
      ["2026-04-30", "2026-03-31", "2026-02-28", "2026-01-31"]
    );
  });

  await t.test("cada ocurrencia sabe cuándo cierra su ventana", () => {
    const [primera] = historyOccurrences(diaria, { limit: 1, today: HOY }).occurrences;
    assert.equal(primera.next, "2026-09-22");
  });
});

test("historyOccurrences — sin nada que enseñar", async (t) => {
  await t.test("programación que empieza en el futuro", () => {
    const futura = { startDate: "2026-12-01", frequency: "daily", interval: 1 };
    assert.deepEqual(historyOccurrences(futura, { limit: 10, today: HOY }), {
      occurrences: [],
      nextBefore: null,
      total: 0,
    });
  });

  await t.test("cursor anterior al inicio de la programación", () => {
    const { occurrences } = historyOccurrences(diaria, { before: "2023-12-31", limit: 10, today: HOY });
    assert.deepEqual(occurrences, []);
  });

  await t.test("fechas inválidas no revientan", () => {
    assert.deepEqual(historyOccurrences(null, { today: HOY }).occurrences, []);
    assert.deepEqual(historyOccurrences(diaria, { today: "ayer" }).occurrences, []);
    assert.deepEqual(historyOccurrences(diaria, { before: "31-12-2025", today: HOY }).occurrences, []);
  });

  await t.test('"once" tiene exactamente una', () => {
    const unica = { startDate: "2026-09-01", frequency: "once", interval: 1 };
    const { occurrences, total, nextBefore } = historyOccurrences(unica, { limit: 10, today: HOY });
    assert.deepEqual(
      occurrences.map((o) => o.date),
      ["2026-09-01"]
    );
    assert.equal(total, 1);
    assert.equal(nextBefore, null);
  });
});
