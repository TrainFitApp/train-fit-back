const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PRESETS, runPresets } = require("./presets");

test("los presets van en el orden del día D: recetas, rutinas y dietas", () => {
  assert.deepEqual(
    PRESETS.map((preset) => preset.name),
    ["recetas verificadas", "rutinas públicas", "dietas de fábrica"],
  );
});

test("lanza cada preset con las mismas opciones y dice cuáles no se crearon enteros", async () => {
  const calls = [];
  const fake = (name, stats) => ({
    name,
    run: async (options) => {
      calls.push({ name, dryRun: options.dryRun, ownerEmail: options.ownerEmail });
      options.log("hecho");
      return stats;
    },
  });
  const logs = [];

  const { results, incomplete } = await runPresets({
    presets: [
      fake("recetas", { created: 2, blocked: 0, missingProducts: 0 }),
      fake("rutinas", { created: 1, blocked: 1, missingExercises: 2 }),
      fake("dietas", { created: 0, blocked: 0, missingProducts: 1 }),
    ],
    dryRun: true,
    ownerEmail: "admin@x.test",
    log: (...parts) => logs.push(parts.join(" ")),
  });

  assert.deepEqual(calls.map((call) => call.name), ["recetas", "rutinas", "dietas"]);
  assert.ok(calls.every((call) => call.dryRun === true && call.ownerEmail === "admin@x.test"));
  assert.deepEqual(results.map((result) => result.stats.created), [2, 1, 0]);
  assert.deepEqual(incomplete, ["rutinas", "dietas"]);
  assert.ok(logs.includes("recetas (dry-run)"));
  assert.ok(logs.includes("  rutinas: hecho"), "el log de cada preset sale con su nombre");
});
