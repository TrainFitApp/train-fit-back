const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRoster, weightChangeFor, daysSince } = require("./roster-service");

// La Cartera ordena a los clientes por estas cifras. Un signo invertido o un
// null tratado como cero cambia el orden de la tabla, y con él a quién
// atiende el entrenador primero.

test("weightChangeFor", async (t) => {
  await t.test("primera medición contra la última, con signo", () => {
    const change = weightChangeFor([
      { date: "2026-08-01", weight: 80 },
      { date: "2026-08-15", weight: 78.5 },
      { date: "2026-08-24", weight: 78 },
    ]);
    assert.equal(change.absolute, -2);
    assert.equal(change.percentage, -2.5);
    assert.equal(change.from.date, "2026-08-01");
    assert.equal(change.to.date, "2026-08-24");
    assert.equal(change.measurements, 3);
  });

  await t.test("subida de peso: mismo cálculo, signo positivo", () => {
    const change = weightChangeFor([
      { date: "2026-08-01", weight: 70 },
      { date: "2026-08-24", weight: 72.1 },
    ]);
    assert.equal(change.absolute, 2.1);
    assert.equal(change.percentage, 3);
  });

  await t.test("con una sola medición no hay variación que reportar", () => {
    assert.equal(weightChangeFor([{ date: "2026-08-01", weight: 80 }]), null);
  });

  await t.test("sin mediciones devuelve null, no un 0 (que parecería 'no se ha movido')", () => {
    assert.equal(weightChangeFor([]), null);
    assert.equal(weightChangeFor(null), null);
  });

  await t.test("ignora las mediciones sin peso en vez de contarlas como 0", () => {
    // Una medición de solo perímetros (sin báscula) es lo normal; si su
    // `weight` undefined entrara en el cálculo, saldría un -100%.
    const change = weightChangeFor([
      { date: "2026-08-01", weight: 80 },
      { date: "2026-08-10", navel: 85 },
      { date: "2026-08-24", weight: 79 },
    ]);
    assert.equal(change.absolute, -1);
    assert.equal(change.measurements, 2);
  });

  await t.test("con menos de dos pesos reales no reporta aunque haya varias mediciones", () => {
    assert.equal(
      weightChangeFor([
        { date: "2026-08-01", weight: 80 },
        { date: "2026-08-10", navel: 85 },
      ]),
      null
    );
  });

  await t.test("ningún valor sale como NaN, undefined o null en los campos numéricos", () => {
    const change = weightChangeFor([
      { date: "2026-08-01", weight: 80 },
      { date: "2026-08-24", weight: 77.3 },
    ]);
    for (const value of [change.absolute, change.percentage, change.measurements]) {
      assert.equal(Number.isFinite(value), true, `valor no finito: ${value}`);
    }
  });
});

test("daysSince", async (t) => {
  const now = new Date("2026-08-24T12:00:00.000Z");

  await t.test("hoy mismo son 0 días, no 1", () => {
    assert.equal(daysSince("2026-08-24T09:00:00.000Z", now), 0);
  });

  await t.test("cuenta días completos transcurridos", () => {
    assert.equal(daysSince("2026-08-17T12:00:00.000Z", now), 7);
  });

  await t.test("sin fecha devuelve null — 'nunca' no es 'hace 0 días'", () => {
    assert.equal(daysSince(null, now), null);
    assert.equal(daysSince(undefined, now), null);
  });
});

// La Cartera entera depende de dos funciones que viven en otro componente
// (coachAlerts). Ese acoplamiento es DELIBERADO —reutilizar el contexto del
// evaluador de alertas en vez de duplicarlo era el objetivo del movimiento 1—
// pero no lo cubría ningún test: `loadTrainerContext` estaba declarada y NO
// exportada, así que buildRoster lanzaba "loadTrainerContext is not a
// function" en cuanto alguien abría la pestaña. Compiló, pasó los 517 tests
// y habría llegado a producción.
test("contrato con coachAlerts", async (t) => {
  const coachAlertService = require("../coachAlerts/coach-alert-service");

  await t.test("coach-alert-service exporta lo que la Cartera importa", () => {
    for (const nombre of ["loadTrainerContext", "buildClientSnapshots", "ensureEvaluatedToday"]) {
      assert.equal(
        typeof coachAlertService[nombre],
        "function",
        `coach-alert-service debe exportar ${nombre}: roster-service lo importa`
      );
    }
  });

  await t.test("buildRoster es invocable", () => {
    assert.equal(typeof buildRoster, "function");
  });
});
