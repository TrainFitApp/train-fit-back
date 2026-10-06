const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { buildHiddenRecentStages } = require("./recent-food-match");

// Ocultar un reciente de una comida no es un borrado: si el cliente vuelve a
// añadir ese alimento DESPUÉS de ocultarlo, tiene que reaparecer. Lo decide el
// _id del CustomProduct (un ObjectId lleva dentro su hora de creación), no la
// fecha del día — se pueden planificar días futuros o copiar días antiguos, y
// entonces la fecha no dice cuándo se añadió de verdad.

const REF = "customProduct.product";
const ENTRY = "customProduct._id";
const opts = { refField: REF, entryIdField: ENTRY };

/** ObjectId creado en ese instante, como el que genera mongo al insertar. */
const idAt = (date) => mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));

const clauseOf = (stages) => stages[0].$match.$nor;

test("sin nada oculto no añade etapas al pipeline", () => {
  assert.deepEqual(buildHiddenRecentStages([], opts), []);
  assert.deepEqual(buildHiddenRecentStages(null, opts), []);
  assert.deepEqual(buildHiddenRecentStages(undefined, opts), []);
  assert.deepEqual(buildHiddenRecentStages("no es una lista", opts), []);
});

test("oculta por producto y por antigüedad de la entrada", () => {
  const hiddenAt = new Date("2026-09-20T10:00:00Z");
  const stages = buildHiddenRecentStages([{ refId: "product-1", hiddenAt }], opts);
  assert.equal(stages.length, 1);
  const [clause] = clauseOf(stages);
  assert.equal(clause[REF], "product-1");
  assert.ok(clause[ENTRY].$lt instanceof mongoose.Types.ObjectId);
});

test("una entrada añadida ANTES de ocultar queda fuera de los recientes", () => {
  const hiddenAt = new Date("2026-09-20T10:00:00Z");
  const [clause] = clauseOf(buildHiddenRecentStages([{ refId: "product-1", hiddenAt }], opts));
  const added = idAt(new Date("2026-09-19T10:00:00Z"));
  assert.ok(added < clause[ENTRY].$lt, "debería casar con el $nor y quedar oculta");
});

test("una entrada añadida en el MISMO segundo también queda oculta", () => {
  // El corte es el primer ObjectId del segundo siguiente: si fuera el del
  // mismo segundo, ocultar justo después de añadir no haría nada.
  const hiddenAt = new Date("2026-09-20T10:00:00Z");
  const [clause] = clauseOf(buildHiddenRecentStages([{ refId: "product-1", hiddenAt }], opts));
  const added = idAt(new Date("2026-09-20T10:00:00Z"));
  assert.ok(added < clause[ENTRY].$lt);
});

test("volver a añadirlo DESPUÉS lo devuelve a los recientes", () => {
  const hiddenAt = new Date("2026-09-20T10:00:00Z");
  const [clause] = clauseOf(buildHiddenRecentStages([{ refId: "product-1", hiddenAt }], opts));
  const addedAgain = idAt(new Date("2026-09-21T10:00:00Z"));
  assert.ok(addedAgain >= clause[ENTRY].$lt, "no debería casar con el $nor");
});

test('"borrar todos" (sin refId) oculta cualquier producto anterior al corte', () => {
  const stages = buildHiddenRecentStages(
    [{ hiddenAt: new Date("2026-09-20T10:00:00Z") }],
    opts,
  );
  const [clause] = clauseOf(stages);
  assert.equal(REF in clause, false, "sin refId la condición no mira qué producto es");
  assert.ok(clause[ENTRY].$lt);
});

test("varios ocultos generan una condición por cada uno", () => {
  const clauses = clauseOf(
    buildHiddenRecentStages(
      [
        { refId: "product-1", hiddenAt: new Date("2026-09-20T10:00:00Z") },
        { refId: "product-2", hiddenAt: new Date("2026-09-25T10:00:00Z") },
      ],
      opts,
    ),
  );
  assert.equal(clauses.length, 2);
  assert.equal(clauses[0][REF], "product-1");
  assert.equal(clauses[1][REF], "product-2");
  assert.ok(clauses[0][ENTRY].$lt < clauses[1][ENTRY].$lt, "cada uno con su propio corte");
});

test("las etapas usan los campos que se le pasan, no unos fijos", () => {
  // El mismo constructor sirve para productos y para recetas, que viven en
  // campos distintos del pipeline.
  const [clause] = clauseOf(
    buildHiddenRecentStages([{ refId: "recipe-1", hiddenAt: new Date() }], {
      refField: "customRecipe.recipe",
      entryIdField: "customRecipe._id",
    }),
  );
  assert.ok("customRecipe.recipe" in clause);
  assert.ok("customRecipe._id" in clause);
});
