const test = require("node:test");
const assert = require("node:assert/strict");
const { addDaysToIsoDate } = require("../util/period-util");
const { projectSchedule, projectionInRange, getProjectedPhaseEndDate } = require("./routine-assignment-projection");

// Tres microciclos de dos entrenamientos cada uno: la unidad mínima para
// comprobar que "aplanar" cruza de un split al siguiente sin perder el
// orden ni desalinear las fechas.
function split(name, workoutNames) {
  return {
    name,
    workouts: workoutNames.map((n, i) => ({ _id: `${name}-${i}`, name: n, isPlannedRestDay: false })),
  };
}

test("projectSchedule", async (t) => {
  await t.test("un workout por día, empezando en startDate", () => {
    const splits = [split("S1", ["Pierna", "Empuje"])];
    const schedule = projectSchedule("2026-09-01", splits);
    assert.deepEqual(
      schedule.map((row) => row.date),
      ["2026-09-01", "2026-09-02"]
    );
  });

  await t.test("varios splits se aplanan en UNA sola secuencia continua", () => {
    const splits = [split("S1", ["A", "B"]), split("S2", ["C", "D"])];
    const schedule = projectSchedule("2026-09-01", splits);
    assert.deepEqual(
      schedule.map((row) => row.name),
      ["A", "B", "C", "D"]
    );
    // El primer día de S2 sigue inmediatamente al último de S1, sin hueco.
    assert.equal(schedule[2].date, "2026-09-03");
  });

  await t.test("un día de descanso pautado cuenta como un día más de la secuencia", () => {
    const splits = [
      {
        name: "S1",
        workouts: [
          { _id: "w1", name: "Pierna", isPlannedRestDay: false },
          { _id: "w2", name: "Descanso", isPlannedRestDay: true },
          { _id: "w3", name: "Empuje", isPlannedRestDay: false },
        ],
      },
    ];
    const schedule = projectSchedule("2026-09-01", splits);
    assert.equal(schedule.length, 3);
    assert.equal(schedule[1].isPlannedRestDay, true);
    assert.equal(schedule[2].date, "2026-09-03");
  });

  await t.test("sin splits o sin workouts, secuencia vacía", () => {
    assert.deepEqual(projectSchedule("2026-09-01", []), []);
    assert.deepEqual(projectSchedule("2026-09-01", [split("S1", [])]), []);
  });
});

test("projectionInRange", async (t) => {
  await t.test("recorta la proyección completa al rango pedido", () => {
    const splits = [split("S1", ["A", "B", "C", "D"])];
    const rows = projectionInRange("2026-09-01", splits, "2026-09-02", "2026-09-03");
    assert.deepEqual(
      rows.map((row) => row.name),
      ["B", "C"]
    );
  });
});

// "Cuándo se acabaría esta fase" (2026-09) — mismo mecanismo que ya usa la
// adherencia (routine-assignment-schedule.js), solo que en vez de contar
// cuántos días caen dentro de una ventana, se pide el ÚLTIMO día de la
// rutina entera.
test("getProjectedPhaseEndDate", async (t) => {
  await t.test("es la fecha del último workout de la rutina entera", () => {
    const splits = [split("S1", ["A", "B"]), split("S2", ["C", "D", "E"])];
    // 5 entrenamientos en total: día 0 a día 4 desde el startDate.
    const expected = addDaysToIsoDate("2026-09-01", 4);
    assert.equal(getProjectedPhaseEndDate("2026-09-01", splits), expected);
  });

  await t.test("una rutina de un solo entrenamiento termina el mismo día que empieza", () => {
    const splits = [split("S1", ["Único"])];
    assert.equal(getProjectedPhaseEndDate("2026-09-01", splits), "2026-09-01");
  });

  await t.test("los días de descanso pautado también cuentan para la duración", () => {
    const splits = [
      {
        name: "S1",
        workouts: [
          { _id: "w1", name: "A", isPlannedRestDay: false },
          { _id: "w2", name: "Descanso", isPlannedRestDay: true },
        ],
      },
    ];
    assert.equal(getProjectedPhaseEndDate("2026-09-01", splits), "2026-09-02");
  });

  await t.test("una tabla sin ningún entrenamiento no da fecha (null, no inventada)", () => {
    assert.equal(getProjectedPhaseEndDate("2026-09-01", []), null);
    assert.equal(getProjectedPhaseEndDate("2026-09-01", [split("S1", [])]), null);
  });
});
