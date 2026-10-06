const test = require("node:test");
const assert = require("node:assert/strict");
const { buildWeeks, weekAt, currentWeek, nextWeek } = require("./week-window");
const { addDaysToIsoDate } = require("../util/date-util");

// 2026-09-21 es lunes; 2026-09-27, domingo.

test("buildWeeks — arranque de la fase", async (t) => {
  await t.test("fase que empieza en lunes: S1 es la semana entera", () => {
    const weeks = buildWeeks("2026-09-21", null, "2026-09-23");
    assert.deepEqual(weeks[0], { number: 1, start: "2026-09-21", end: "2026-09-27" });
  });

  await t.test("fase que empieza en miércoles: S1 va de miércoles a domingo", () => {
    const weeks = buildWeeks("2026-09-23", null, "2026-09-25");
    assert.deepEqual(weeks[0], { number: 1, start: "2026-09-23", end: "2026-09-27" });
    assert.deepEqual(weeks[1], { number: 2, start: "2026-09-28", end: "2026-10-04" });
  });

  await t.test("fase que empieza en domingo: S1 dura un solo día", () => {
    const weeks = buildWeeks("2026-09-27", null, "2026-09-27");
    assert.deepEqual(weeks[0], { number: 1, start: "2026-09-27", end: "2026-09-27" });
    assert.equal(weeks[1].start, "2026-09-28");
  });
});

test("buildWeeks — fin de la fase", async (t) => {
  await t.test("una fase de tres días es una sola semana recortada", () => {
    const weeks = buildWeeks("2026-09-23", "2026-09-25");
    assert.deepEqual(weeks, [{ number: 1, start: "2026-09-23", end: "2026-09-25" }]);
  });

  await t.test("fase que acaba en domingo: la última semana no se recorta", () => {
    const weeks = buildWeeks("2026-09-21", "2026-10-04");
    assert.equal(weeks.length, 2);
    assert.deepEqual(weeks[1], { number: 2, start: "2026-09-28", end: "2026-10-04" });
  });

  await t.test("fase que acaba a media semana: la última acaba ese día", () => {
    const weeks = buildWeeks("2026-09-21", "2026-09-30");
    assert.equal(weeks.length, 2);
    assert.deepEqual(weeks[1], { number: 2, start: "2026-09-28", end: "2026-09-30" });
  });

  await t.test("la fase cerrada NO ofrece semana siguiente", () => {
    const weeks = buildWeeks("2026-09-21", "2026-09-30");
    assert.equal(nextWeek(weeks, weeks[weeks.length - 1]), null);
  });
});

test("buildWeeks — fase abierta", async (t) => {
  await t.test("siempre ofrece una semana más que la que contiene hoy", () => {
    const weeks = buildWeeks("2026-09-21", null, "2026-09-23");
    const hoy = currentWeek(weeks, "2026-09-23");
    assert.equal(hoy.number, 1);
    assert.deepEqual(nextWeek(weeks, hoy), { number: 2, start: "2026-09-28", end: "2026-10-04" });
  });

  await t.test("enumera hasta hoy, no se queda en la primera", () => {
    const weeks = buildWeeks("2026-09-21", null, "2026-10-14");
    assert.equal(currentWeek(weeks, "2026-10-14").number, 4);
    assert.equal(weeks.length, 5); // 4 corridas + la que se prepara
  });

  await t.test("fase que aún no ha empezado: S1 y la siguiente", () => {
    const weeks = buildWeeks("2026-10-05", null, "2026-09-21");
    assert.equal(weeks.length, 2);
    assert.equal(currentWeek(weeks, "2026-09-21").number, 1);
  });

  await t.test("el domingo no abre semana nueva", () => {
    const weeks = buildWeeks("2026-09-21", null, "2026-09-27");
    assert.equal(currentWeek(weeks, "2026-09-27").number, 1);
    assert.equal(currentWeek(weeks, "2026-09-28").number, 2);
  });
});

test("buildWeeks — invariantes", async (t) => {
  const casos = [
    ["2026-09-21", null, "2026-11-02"],
    ["2026-09-23", null, "2026-10-20"],
    ["2025-12-29", "2026-02-03"],
    ["2026-09-27", "2026-10-13"],
    ["2028-02-26", "2028-03-15"], // cruza un 29 de febrero
  ];

  await t.test("las ventanas son contiguas y sin huecos", () => {
    for (const [start, end, until] of casos) {
      const weeks = buildWeeks(start, end, until);
      for (let i = 1; i < weeks.length; i++) {
        assert.equal(
          weeks[i].start,
          addDaysToIsoDate(weeks[i - 1].end, 1),
          `${start} → ${end}, semana ${i + 1}`
        );
      }
    }
  });

  await t.test("la numeración va de 1 en 1 y nunca hay end antes que start", () => {
    for (const [start, end, until] of casos) {
      const weeks = buildWeeks(start, end, until);
      weeks.forEach((week, i) => {
        assert.equal(week.number, i + 1);
        assert.ok(week.end >= week.start, `${week.start} → ${week.end}`);
      });
    }
  });

  await t.test("salvo la primera, todas empiezan en lunes", () => {
    for (const [start, end, until] of casos) {
      for (const week of buildWeeks(start, end, until).slice(1)) {
        const weekday = new Date(`${week.start}T00:00:00.000Z`).getUTCDay();
        assert.equal(weekday, 1, `${week.start} no es lunes`);
      }
    }
  });

  await t.test("sin fecha de inicio no hay semanas", () => {
    assert.deepEqual(buildWeeks(null), []);
    assert.deepEqual(buildWeeks(""), []);
  });
});

test("weekAt / currentWeek", async (t) => {
  const weeks = buildWeeks("2026-09-23", "2026-10-13");

  await t.test("weekAt encuentra la ventana de una fecha", () => {
    assert.equal(weekAt(weeks, "2026-09-23").number, 1);
    assert.equal(weekAt(weeks, "2026-09-27").number, 1);
    assert.equal(weekAt(weeks, "2026-09-28").number, 2);
    assert.equal(weekAt(weeks, "2026-10-13").number, 4);
  });

  await t.test("weekAt devuelve null fuera de la fase", () => {
    assert.equal(weekAt(weeks, "2026-09-22"), null);
    assert.equal(weekAt(weeks, "2026-10-14"), null);
  });

  await t.test("currentWeek se queda en la última cuando la fase ya acabó", () => {
    assert.equal(currentWeek(weeks, "2026-11-01").number, 4);
  });

  await t.test("currentWeek sin semanas es null", () => {
    assert.equal(currentWeek([], "2026-09-23"), null);
  });
});
