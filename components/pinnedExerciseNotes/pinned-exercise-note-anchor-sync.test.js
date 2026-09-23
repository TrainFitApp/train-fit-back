const test = require("node:test");
const assert = require("node:assert/strict");
const { captureAnchors, resolveAnchors } = require("./pinned-exercise-note-anchor-sync");

// Dos microciclos, dos filas. Mismo "ejercicio" en cada microciclo = ids
// distintos (a1 en split 0, a2 en split 1), igual que en la BD real.
const before = [
  [["a1", "b1", "c1"], ["d1", "e1"]],
  [["a2", "b2", "c2"], ["d2", "e2"]],
];

const note = (id, workoutIndex, exerciseIndex) => ({ _id: id, workoutIndex, exerciseIndex });

test("mover un ejercicio arrastra su nota", () => {
  const anchors = captureAnchors([note("n1", 0, 0)], before);
  const after = [
    [["b1", "c1", "a1"], ["d1", "e1"]],
    [["b2", "c2", "a2"], ["d2", "e2"]],
  ];
  assert.deepEqual(resolveAnchors(anchors, after), {
    moves: [{ noteId: "n1", workoutIndex: 0, exerciseIndex: 2 }],
    deletes: [],
  });
});

test("intercambio de dos ejercicios con nota", () => {
  const anchors = captureAnchors([note("n1", 0, 0), note("n2", 0, 1)], before);
  const after = [
    [["b1", "a1", "c1"], ["d1", "e1"]],
    [["b2", "a2", "c2"], ["d2", "e2"]],
  ];
  const { moves, deletes } = resolveAnchors(anchors, after);
  assert.deepEqual(deletes, []);
  assert.deepEqual(
    moves.sort((x, y) => x.noteId.localeCompare(y.noteId)),
    [
      { noteId: "n1", workoutIndex: 0, exerciseIndex: 1 },
      { noteId: "n2", workoutIndex: 0, exerciseIndex: 0 },
    ],
  );
});

test("borrar un ejercicio borra su nota y sube las siguientes", () => {
  const anchors = captureAnchors([note("n1", 0, 0), note("n2", 0, 2)], before);
  const after = [
    [["b1", "c1"], ["d1", "e1"]],
    [["b2", "c2"], ["d2", "e2"]],
  ];
  assert.deepEqual(resolveAnchors(anchors, after), {
    moves: [{ noteId: "n2", workoutIndex: 0, exerciseIndex: 1 }],
    deletes: ["n1"],
  });
});

test("reordenar filas mueve workoutIndex", () => {
  const anchors = captureAnchors([note("n1", 1, 1)], before);
  const after = [
    [["d1", "e1"], ["a1", "b1", "c1"]],
    [["d2", "e2"], ["a2", "b2", "c2"]],
  ];
  assert.deepEqual(resolveAnchors(anchors, after).moves, [
    { noteId: "n1", workoutIndex: 0, exerciseIndex: 1 },
  ]);
});

test("reordenar una sola columna no mueve la nota de la fila (gana la mayoría)", () => {
  const three = [...before, [["a3", "b3", "c3"], ["d3", "e3"]]];
  const anchors = captureAnchors([note("n1", 0, 0)], three);
  const after = [
    [["d1", "e1"], ["a1", "b1", "c1"]],
    three[1],
    three[2],
  ];
  assert.deepEqual(resolveAnchors(anchors, after), { moves: [], deletes: [] });
});

test("sin cambios no hace nada", () => {
  const anchors = captureAnchors([note("n1", 0, 1), note("n2", 1, 0)], before);
  assert.deepEqual(resolveAnchors(anchors, before), { moves: [], deletes: [] });
});

test("nota huérfana se queda salvo que otra necesite su hueco", () => {
  const anchors = captureAnchors([note("orphan", 0, 3), note("n1", 0, 0)], before);
  assert.deepEqual(resolveAnchors(anchors, before), { moves: [], deletes: [] });

  const after = [
    [["b1", "c1", "x1", "a1"], ["d1", "e1"]],
    [["b2", "c2", "x2", "a2"], ["d2", "e2"]],
  ];
  assert.deepEqual(resolveAnchors(anchors, after), {
    moves: [{ noteId: "n1", workoutIndex: 0, exerciseIndex: 3 }],
    deletes: ["orphan"],
  });
});
