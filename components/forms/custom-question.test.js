const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CUSTOM_QUESTION_TYPES,
  FREQUENCY_OPTIONS,
  customKeyFor,
  isCustomKey,
  questionIdFromKey,
  validateCustomAnswer,
  normalizeCustomAnswer,
  validateQuestionDefinition,
} = require("./custom-question");
const { CHECKIN_FIELD_KEYS } = require("../trainerCheckins/checkin-field-catalog");

// Las respuestas de check-in son el dato que alimenta alertas, comparativas
// y reglas. Una validación laxa mete basura ahí sin ningún error visible.

test("claves de pregunta propia", async (t) => {
  await t.test("van prefijadas y se pueden volver a leer", () => {
    const key = customKeyFor("507f1f77bcf86cd799439011");
    assert.equal(key, "custom:507f1f77bcf86cd799439011");
    assert.equal(isCustomKey(key), true);
    assert.equal(questionIdFromKey(key), "507f1f77bcf86cd799439011");
  });

  await t.test("NINGUNA clave del catálogo cerrado puede confundirse con una propia", () => {
    // Si un campo del catálogo empezara por "custom:", el validador lo
    // trataría como pregunta libre y se saltaría su validación de tipo.
    for (const key of CHECKIN_FIELD_KEYS) {
      assert.equal(isCustomKey(key), false, `${key} colisiona con el prefijo`);
    }
  });

  await t.test("una clave normal no es de pregunta propia", () => {
    assert.equal(isCustomKey("weight"), false);
    assert.equal(questionIdFromKey("weight"), null);
    assert.equal(isCustomKey(undefined), false);
  });
});

test("validateQuestionDefinition", async (t) => {
  await t.test("acepta una pregunta bien formada de cada tipo", () => {
    for (const type of CUSTOM_QUESTION_TYPES) {
      const question = { label: "¿Cómo vas?", type };
      if (type === "select") question.options = ["A", "B"];
      assert.equal(validateQuestionDefinition(question), null, `tipo ${type}`);
    }
  });

  await t.test("rechaza enunciado vacío", () => {
    assert.ok(validateQuestionDefinition({ label: "  ", type: "text" }));
  });

  await t.test("rechaza tipo desconocido", () => {
    assert.ok(validateQuestionDefinition({ label: "X", type: "estrella" }));
  });

  await t.test("un selector con menos de 2 opciones no es un selector", () => {
    assert.ok(validateQuestionDefinition({ label: "X", type: "select", options: ["Solo una"] }));
    assert.ok(validateQuestionDefinition({ label: "X", type: "select", options: [] }));
  });

  await t.test("las opciones en blanco no cuentan para el mínimo", () => {
    assert.ok(validateQuestionDefinition({ label: "X", type: "select", options: ["A", "  "] }));
  });
});

test("validateCustomAnswer", async (t) => {
  const q = (type, extra = {}) => ({ label: "Pregunta", type, ...extra });

  await t.test("una opcional sin responder es válida", () => {
    assert.equal(validateCustomAnswer(q("text"), ""), null);
    assert.equal(validateCustomAnswer(q("number"), null), null);
    assert.equal(validateCustomAnswer(q("scale_1_5"), undefined), null);
  });

  await t.test("una obligatoria sin responder NO lo es", () => {
    assert.ok(validateCustomAnswer(q("text", { required: true }), ""));
    assert.ok(validateCustomAnswer(q("number", { required: true }), null));
  });

  await t.test("escala 1-5 respeta sus límites", () => {
    assert.equal(validateCustomAnswer(q("scale_1_5"), 1), null);
    assert.equal(validateCustomAnswer(q("scale_1_5"), 5), null);
    assert.ok(validateCustomAnswer(q("scale_1_5"), 0));
    assert.ok(validateCustomAnswer(q("scale_1_5"), 6));
    assert.ok(validateCustomAnswer(q("scale_1_5"), "mucho"));
  });

  await t.test("número rechaza negativos y no-números", () => {
    assert.equal(validateCustomAnswer(q("number"), 12), null);
    assert.equal(validateCustomAnswer(q("number"), "12"), null, "los formularios envían strings");
    assert.ok(validateCustomAnswer(q("number"), -1));
    assert.ok(validateCustomAnswer(q("number"), "bastante"));
  });

  await t.test("texto tiene tope de longitud", () => {
    assert.equal(validateCustomAnswer(q("text"), "bien"), null);
    assert.ok(validateCustomAnswer(q("text"), "x".repeat(1001)));
    assert.ok(validateCustomAnswer(q("text"), 42));
  });

  await t.test("sí/no acepta booleano y sus formas de texto", () => {
    assert.equal(validateCustomAnswer(q("yes_no"), true), null);
    assert.equal(validateCustomAnswer(q("yes_no"), false), null);
    assert.equal(validateCustomAnswer(q("yes_no"), "true"), null);
    assert.ok(validateCustomAnswer(q("yes_no"), "quizá"));
  });

  await t.test("selector solo admite sus propias opciones", () => {
    const question = q("select", { options: ["Casa", "Gimnasio"] });
    assert.equal(validateCustomAnswer(question, "Casa"), null);
    assert.ok(validateCustomAnswer(question, "Parque"));
  });

  await t.test("frecuencia solo admite la escala fija", () => {
    assert.equal(validateCustomAnswer(q("frequency"), "A veces"), null);
    assert.ok(validateCustomAnswer(q("frequency"), "De vez en cuando"));
    assert.equal(FREQUENCY_OPTIONS.length, 5);
  });

  await t.test("un tipo desconocido no cuela ningún valor", () => {
    assert.ok(validateCustomAnswer(q("estrella"), 3));
  });
});

test("normalizeCustomAnswer", async (t) => {
  await t.test("el texto se recorta", () => {
    assert.equal(normalizeCustomAnswer({ type: "text" }, "  bien  "), "bien");
  });

  await t.test("sí/no acaba siendo booleano venga como venga", () => {
    assert.equal(normalizeCustomAnswer({ type: "yes_no" }, "true"), true);
    assert.equal(normalizeCustomAnswer({ type: "yes_no" }, "false"), false);
    assert.equal(normalizeCustomAnswer({ type: "yes_no" }, true), true);
  });

  await t.test("los numéricos se guardan como número, no como string", () => {
    // Si no, una comparativa semanal promediaría strings y daría NaN.
    assert.strictEqual(normalizeCustomAnswer({ type: "number" }, "12"), 12);
    assert.strictEqual(normalizeCustomAnswer({ type: "scale_1_5" }, "4"), 4);
  });

  await t.test("selector y frecuencia se guardan tal cual", () => {
    assert.equal(normalizeCustomAnswer({ type: "select" }, "Casa"), "Casa");
    assert.equal(normalizeCustomAnswer({ type: "frequency" }, "Siempre"), "Siempre");
  });
});
