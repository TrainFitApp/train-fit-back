const test = require("node:test");
const assert = require("node:assert/strict");
const { addDaysToIsoDate } = require("../util/date-util");
const {
  projectSchedule,
  projectionInRange,
  projectionAcrossAssignments,
  getProjectedPhaseEndDate,
} = require("./routine-assignment-projection");

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

  await t.test("cada día lleva el número (1-based) de su microciclo", () => {
    const splits = [split("S1", ["A", "B"]), split("S2", []), split("S3", ["C"])];
    const schedule = projectSchedule("2026-09-01", splits);
    assert.deepEqual(
      schedule.map((row) => row.microcycleNumber),
      [1, 1, 3]
    );
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

// Fase A2 (2026-09) — el bug real que motiva esto: programar una fase
// nueva la marca "active" en BD de inmediato aunque empiece en el futuro,
// así que /active/schedule (que antes solo proyectaba "la activa") pintaba
// TODO el rango pedido con la tabla nueva, incluidos los días que hasta esa
// fecha siguen rigiendo la fase anterior. projectionAcrossAssignments
// recorta cada fase a lo que de verdad gobierna.
test("projectionAcrossAssignments", async (t) => {
  await t.test("una sola fase se comporta igual que projectionInRange", () => {
    const tableById = new Map([["t1", { splits: [split("S1", ["A", "B", "C"])] }]]);
    const rows = projectionAcrossAssignments(
      [{ _id: "a1", tableId: "t1", startDate: "2026-09-01" }],
      tableById,
      "2026-09-01",
      "2026-09-03"
    );
    assert.deepEqual(rows.map((r) => r.name), ["A", "B", "C"]);
    assert.ok(rows.every((r) => r.assignmentId === "a1"));
  });

  await t.test("dos fases encadenadas: cada una solo pinta SU tramo, no todo el rango", () => {
    const tableById = new Map([
      ["t1", { splits: [split("S1", ["Fuerza-A", "Fuerza-B", "Fuerza-C", "Fuerza-D"])] }],
      ["t2", { splits: [split("S1", ["Hip-A", "Hip-B"])] }],
    ]);
    // Fase 1 empieza 09-01; fase 2 (recién programada, ya "active" en BD)
    // empieza 09-05 — antes del fix, TODO el rango pedido (09-01..09-06)
    // salía proyectado con la tabla de la fase 2.
    const assignments = [
      { _id: "a1", tableId: "t1", startDate: "2026-09-01" },
      { _id: "a2", tableId: "t2", startDate: "2026-09-05" },
    ];
    const rows = projectionAcrossAssignments(assignments, tableById, "2026-09-01", "2026-09-06");

    const byDate = new Map(rows.map((r) => [r.date, r]));
    // Los días previos al 09-05 siguen siendo de la fase 1, con SU tabla.
    assert.equal(byDate.get("2026-09-01").name, "Fuerza-A");
    assert.equal(byDate.get("2026-09-01").assignmentId, "a1");
    assert.equal(byDate.get("2026-09-04").name, "Fuerza-D");
    assert.equal(byDate.get("2026-09-04").assignmentId, "a1");
    // Desde el 09-05 en adelante, la fase 2 con SU tabla — no antes.
    assert.equal(byDate.get("2026-09-05").name, "Hip-A");
    assert.equal(byDate.get("2026-09-05").assignmentId, "a2");
    assert.equal(byDate.get("2026-09-06").name, "Hip-B");
    assert.equal(byDate.get("2026-09-06").assignmentId, "a2");
  });

  await t.test("orden de entrada no importa: se ordena por startDate", () => {
    const tableById = new Map([
      ["t1", { splits: [split("S1", ["A"])] }],
      ["t2", { splits: [split("S1", ["B"])] }],
    ]);
    const assignments = [
      { _id: "a2", tableId: "t2", startDate: "2026-09-05" },
      { _id: "a1", tableId: "t1", startDate: "2026-09-01" },
    ];
    const rows = projectionAcrossAssignments(assignments, tableById, "2026-09-01", "2026-09-05");
    assert.deepEqual(
      rows.map((r) => r.assignmentId),
      ["a1", "a2"]
    );
  });

  await t.test("una fase fuera del rango pedido no aporta filas", () => {
    const tableById = new Map([["t1", { splits: [split("S1", ["A"])] }]]);
    const rows = projectionAcrossAssignments(
      [{ _id: "a1", tableId: "t1", startDate: "2026-01-01" }],
      tableById,
      "2026-09-01",
      "2026-09-05"
    );
    assert.deepEqual(rows, []);
  });

  await t.test("tabla borrada (no está en tableById) se salta esa fase sin romper el resto", () => {
    const tableById = new Map([["t2", { splits: [split("S1", ["B"])] }]]);
    const assignments = [
      { _id: "a1", tableId: "t1-borrada", startDate: "2026-09-01" },
      { _id: "a2", tableId: "t2", startDate: "2026-09-05" },
    ];
    const rows = projectionAcrossAssignments(assignments, tableById, "2026-09-01", "2026-09-05");
    assert.deepEqual(
      rows.map((r) => r.assignmentId),
      ["a2"]
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
