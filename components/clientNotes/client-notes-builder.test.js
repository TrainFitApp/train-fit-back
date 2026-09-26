const test = require("node:test");
const assert = require("node:assert/strict");
const {
  textHash,
  buildTrainingNotes,
  buildPainNotes,
  buildNutritionNotes,
  sortNotes,
  applyReadState,
  filterNotes,
  countUnseen,
  paginate,
} = require("./client-notes-builder");

function trainingFixture() {
  return {
    tables: [{ _id: "t1", name: "prueba", splits: ["s1", "s2"] }],
    splits: [
      { _id: "s1", workouts: ["w1"] },
      { _id: "s2", workouts: ["w2"] },
    ],
    workouts: [
      { _id: "w1", name: "Pierna", exercises: ["ce1"], date: new Date("2026-09-01T10:00:00Z") },
      { _id: "w2", name: "", notes: "Me costó mucho", exercises: ["ce2"], date: new Date("2026-09-08T10:00:00Z") },
    ],
    customExercises: [
      { _id: "ce1", exercise: "e1" },
      { _id: "ce2", exercise: "e1", clientNotes: "Molestia en el hombro" },
    ],
    exercises: [{ _id: "e1", name: "Press banca" }],
    pinnedNotes: [{ _id: "p1", tableId: "t1", workoutIndex: 0, exerciseIndex: 0, notes: "Agarre ancho", updatedAt: new Date("2026-09-05T00:00:00Z") }],
  };
}

test("entrenamiento: nota de sesión y de ejercicio con su ruta y destino", () => {
  const notes = buildTrainingNotes(trainingFixture());
  const session = notes.find((note) => note.sourceType === "workout");
  assert.deepEqual(session.path, ["Entrenamiento", "Rutina: prueba", "Microciclo 2", "Día 1", "Nota de la sesión"]);
  assert.deepEqual(session.target, { type: "planner", tableId: "t1", splitId: "s2", workoutId: "w2", exerciseId: null });

  const exercise = notes.find((note) => note.sourceType === "exercise");
  assert.deepEqual(exercise.path, ["Entrenamiento", "Rutina: prueba", "Microciclo 2", "Día 1", "Press banca"]);
  assert.equal(exercise.target.exerciseId, "ce2");
  assert.equal(exercise.date, "2026-09-08T10:00:00.000Z");
  assert.equal(exercise.domain, "training");
});

test("entrenamiento: ignora notas vacías o solo con espacios", () => {
  const fixture = trainingFixture();
  fixture.workouts[1].notes = "   ";
  fixture.customExercises[1].clientNotes = "";
  fixture.pinnedNotes = [];
  assert.equal(buildTrainingNotes(fixture).length, 0);
});

test("nota fijada: se ancla al primer microciclo con esa posición", () => {
  const pinned = buildTrainingNotes(trainingFixture()).find((note) => note.sourceType === "pinned");
  assert.deepEqual(pinned.path, ["Entrenamiento", "Rutina: prueba", "Todos los microciclos", "Día 1: Pierna", "Press banca", "Nota fijada"]);
  assert.deepEqual(pinned.target, { type: "planner", tableId: "t1", splitId: "s1", workoutId: "w1", exerciseId: "ce1" });
});

test("nota fijada: sin ejercicio en esa posición sigue saliendo, sin destino concreto", () => {
  const fixture = trainingFixture();
  fixture.pinnedNotes[0].exerciseIndex = 5;
  const pinned = buildTrainingNotes(fixture).find((note) => note.sourceType === "pinned");
  assert.deepEqual(pinned.path.slice(-3), ["Día 1", "Ejercicio 6", "Nota fijada"]);
  assert.equal(pinned.target.splitId, null);
});

test("dolor y nutrición", () => {
  const [pain] = buildPainNotes([{ _id: "pa1", date: "2026-09-10", zone: "Rodilla dcha.", level: 4, note: "Al bajar escaleras" }, { _id: "pa2", date: "2026-09-11", zone: "Cuello", level: 2, note: "" }]);
  assert.deepEqual(pain.path, ["Entrenamiento", "Dolor", "Rodilla dcha. · 4/10"]);
  assert.deepEqual(pain.target, { type: "pain", date: "2026-09-10", zone: "Rodilla dcha." });

  const notes = buildNutritionNotes({
    dietDays: [{ _id: "d1", date: "2026-09-12", menuName: "Día alto", notes: "Cena fuera", meals: ["m1", "m2"] }],
    meals: [{ _id: "m1", name: "Desayuno", notes: "Sin hambre" }, { _id: "m2", name: "Comida", notes: "" }],
  });
  assert.equal(notes.length, 2);
  const meal = notes.find((note) => note.sourceType === "meal");
  assert.deepEqual(meal.path, ["Nutrición", "Menú: Día alto", "Desayuno"]);
  assert.deepEqual(meal.target, { type: "nutrition", date: "2026-09-12", mealId: "m1" });
  assert.equal(meal.domain, "nutrition");
});

test("leído: coincide por texto; si el cliente edita, vuelve a no vista", () => {
  const [note] = buildPainNotes([{ _id: "pa1", date: "2026-09-10", zone: "Cuello", level: 3, note: "Rígido" }]);
  assert.equal(applyReadState([note], [{ noteKey: "pain:pa1", textHash: textHash("Rígido") }])[0].seen, true);
  assert.equal(applyReadState([note], [{ noteKey: "pain:pa1", textHash: textHash("Otro texto") }])[0].seen, false);
  assert.equal(applyReadState([note], [])[0].seen, false);
});

test("filtros: scopes, ámbito, visto y búsqueda sin tildes", () => {
  const notes = applyReadState(
    [
      ...buildTrainingNotes(trainingFixture()),
      ...buildNutritionNotes({ dietDays: [{ _id: "d1", date: "2026-09-12", notes: "Cena fuera", meals: [] }] }),
    ],
    [{ noteKey: "exercise:ce2", textHash: textHash("Molestia en el hombro") }]
  );
  assert.equal(filterNotes(notes, { scopes: ["nutrition"] }).length, 1);
  assert.equal(filterNotes(notes, { scopes: ["training", "nutrition"], domain: "training" }).length, 3);
  assert.equal(filterNotes(notes, { scopes: ["training", "nutrition"], seen: true }).length, 1);
  assert.equal(filterNotes(notes, { scopes: ["training", "nutrition"], q: "COSTO" }).length, 1);
  assert.equal(filterNotes(notes, { scopes: ["training", "nutrition"], q: "press" }).length, 2);
  assert.equal(filterNotes(notes, { scopes: [] }).length, 0);

  assert.deepEqual(countUnseen(filterNotes(notes, { scopes: ["training", "nutrition"] })), { total: 3, training: 2, nutrition: 1 });
});

test("orden por fecha descendente y paginación sin exponer el hash", () => {
  const sorted = sortNotes(buildTrainingNotes(trainingFixture()));
  // Sesión y ejercicio comparten fecha (la de la sesión): desempata la clave.
  assert.deepEqual(sorted.map((note) => note.sourceType), ["exercise", "workout", "pinned"]);

  const page = paginate(sorted, { page: 0, limit: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 3);
  assert.equal(page.hasMore, true);
  assert.equal("hash" in page.items[0], false);
  assert.equal(paginate(sorted, { page: 1, limit: 2 }).hasMore, false);
  assert.equal(paginate(sorted, { limit: 999 }).limit, 100);
});
