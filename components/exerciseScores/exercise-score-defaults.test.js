const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { getDefaultScoreForName } = require("./exercise-score-defaults");
const { SCORE_MUSCLES, SCORE_JOINTS, isValidScore } = require("./exercise-score-catalog");

// Estos valores son la SUGERENCIA inicial del formulario de puntuación, no
// una puntuación que nadie ha decidido — pero si el nombre/escala de una
// entrada no es válido, se guardaría silenciosamente vacía (ver
// sanitizeMuscleScores) y el entrenador vería un formulario que dice "sin
// sugerencia" sin saber por qué. Cada entrada tiene que ser un músculo/
// articulación real del catálogo, con una puntuación 0-3.

const MUSCLE_SET = new Set(SCORE_MUSCLES);
const JOINT_SET = new Set(SCORE_JOINTS);

function assertValidDefault(name, result) {
  assert.ok(result, `se esperaba una sugerencia para "${name}"`);
  for (const entry of result.muscleScores) {
    assert.ok(MUSCLE_SET.has(entry.name), `"${entry.name}" no es un músculo del catálogo (${name})`);
    assert.ok(isValidScore(entry.score), `puntuación fuera de escala en "${entry.name}" (${name})`);
  }
  for (const entry of result.jointScores) {
    assert.ok(JOINT_SET.has(entry.name), `"${entry.name}" no es una articulación del catálogo (${name})`);
    assert.ok(isValidScore(entry.score), `puntuación fuera de escala en "${entry.name}" (${name})`);
  }
}

test("getDefaultScoreForName", async (t) => {
  await t.test("nombre vacío o sin sentido no sugiere nada inventado", () => {
    assert.equal(getDefaultScoreForName(""), null);
    assert.equal(getDefaultScoreForName(null), null);
    assert.equal(getDefaultScoreForName("Ejercicio inventado xyz123"), null);
  });

  await t.test("no distingue mayúsculas ni espacios", () => {
    const a = getDefaultScoreForName("Press Banca");
    const b = getDefaultScoreForName("  press banca  ");
    assert.deepEqual(a, b);
  });

  await t.test("press banca: pectoral como objetivo principal", () => {
    const result = getDefaultScoreForName("Press Banca");
    assertValidDefault("Press Banca", result);
    assert.equal(result.muscleScores.find((e) => e.name === "Pectoral")?.score, 3);
  });

  await t.test("sentadilla: cuádriceps como objetivo principal, rodilla cargada", () => {
    const result = getDefaultScoreForName("Sentadilla barra alta");
    assertValidDefault("Sentadilla barra alta", result);
    assert.equal(result.muscleScores.find((e) => e.name === "Cuádriceps")?.score, 3);
    assert.ok(result.jointScores.some((e) => e.name === "Rodilla"));
  });

  await t.test("peso muerto: femoral y glúteo como objetivo, lumbar cargada", () => {
    const result = getDefaultScoreForName("Peso muerto rumano");
    assertValidDefault("Peso muerto rumano", result);
    assert.equal(result.muscleScores.find((e) => e.name === "Femoral")?.score, 3);
    assert.ok(result.jointScores.some((e) => e.name === "Columna lumbar"));
  });

  await t.test("curl femoral no cae en el cubo genérico de bíceps", () => {
    const result = getDefaultScoreForName("Curl femoral tumbado");
    assertValidDefault("Curl femoral tumbado", result);
    assert.equal(result.muscleScores.find((e) => e.name === "Femoral")?.score, 3);
    assert.equal(result.muscleScores.find((e) => e.name === "Bíceps"), undefined);
  });

  await t.test("curl nórdico es isquios, no bíceps, aunque diga 'curl'", () => {
    const result = getDefaultScoreForName("Curl nordico");
    assertValidDefault("Curl nordico", result);
    assert.equal(result.muscleScores.find((e) => e.name === "Femoral")?.score, 3);
    assert.equal(result.muscleScores.find((e) => e.name === "Bíceps"), undefined);
  });

  await t.test("typos reales del catálogo se reconocen igual", () => {
    // "Sentadillla" (triple ele) y "gúteo" (sin ele) son errores reales del
    // catálogo, ver scripts/exercise-description-backup-*.json.
    assertValidDefault("Sentadillla bulgara multipower", getDefaultScoreForName("Sentadillla bulgara multipower"));
    assertValidDefault(
      "Patada de gúteo bilateral en multipower",
      getDefaultScoreForName("Patada de gúteo bilateral en multipower")
    );
  });

  await t.test("variantes en inglés del catálogo (row, rack pull) también encajan", () => {
    assertValidDefault("Seal row", getDefaultScoreForName("Seal row"));
    assertValidDefault("Bend over row", getDefaultScoreForName("Bend over row"));
    assertValidDefault("Rack pull", getDefaultScoreForName("Rack pull"));
  });

  // Regresión sobre el catálogo REAL: si alguien renombra un ejercicio de
  // forma que ningún patrón lo reconozca, este test lo dice — mejor que
  // descubrirlo cuando un entrenador abre el editor y ve el formulario vacío
  // sin saber si es a propósito o un fallo.
  await t.test("todos los ejercicios del catálogo real tienen sugerencia válida", () => {
    const backupPath = path.join(__dirname, "../../scripts/exercise-description-backup-1784831661382.json");
    if (!fs.existsSync(backupPath)) return; // backup solo en local, no bloquea CI si falta

    const raw = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    const names = (Array.isArray(raw) ? raw : Object.values(raw)).map((e) => e.name).filter(Boolean);
    assert.ok(names.length > 0, "el backup no tiene nombres, revisa la ruta");

    const unmatched = [];
    for (const name of names) {
      const result = getDefaultScoreForName(name);
      if (!result || (!result.muscleScores.length && !result.jointScores.length)) {
        unmatched.push(name);
        continue;
      }
      assertValidDefault(name, result);
    }

    assert.deepEqual(unmatched, [], `${unmatched.length} ejercicios sin sugerencia por defecto`);
  });
});
