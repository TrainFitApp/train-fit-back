const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ALERT_COOLDOWN_DAYS,
  buildClientSnapshots,
  buildSignalsFromSnapshots,
  lastActivityFor,
  dedupeKeyFor,
} = require("./coach-alert-service");

const NOW = new Date("2026-08-23T05:00:00.000Z");

function isoDaysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000).toISOString().slice(0, 10);
}

function daysAgo(days) {
  return new Date(NOW.getTime() - days * 86400000);
}

// La clave de deduplicación es la ÚNICA defensa contra que un cliente
// estancado genere una alerta cada noche. Cambiar su formato no rompe nada
// visiblemente: simplemente deja de encontrar las alertas abiertas que ya
// existían y empieza a duplicarlas. De ahí que el formato se fije en un test.
test("dedupeKeyFor", async (t) => {
  await t.test("identifica (profesional, cliente, tipo) y nada más", () => {
    assert.equal(dedupeKeyFor("t1", "c1", "stagnation"), "t1:c1:stagnation");
  });

  await t.test("no depende de la fecha: la misma condición dos noches da la misma clave", () => {
    assert.equal(dedupeKeyFor("t1", "c1", "stagnation"), dedupeKeyFor("t1", "c1", "stagnation"));
  });

  await t.test("distingue cliente y tipo", () => {
    assert.notEqual(dedupeKeyFor("t1", "c1", "stagnation"), dedupeKeyFor("t1", "c2", "stagnation"));
    assert.notEqual(dedupeKeyFor("t1", "c1", "stagnation"), dedupeKeyFor("t1", "c1", "low_adherence"));
  });

  await t.test("acepta ObjectId sin reventar (se interpola como string)", () => {
    const objectIdLike = { toString: () => "507f1f77bcf86cd799439011" };
    assert.equal(
      dedupeKeyFor("t1", objectIdLike, "stagnation"),
      "t1:507f1f77bcf86cd799439011:stagnation"
    );
  });
});

test("lastActivityFor", async (t) => {
  await t.test("sin ninguna señal de vida -> null (no se inventa antigüedad)", () => {
    assert.equal(lastActivityFor({ lastResponseAt: null, entries: [], adherence: null, now: NOW }), null);
  });

  await t.test("con días de dieta registrados -> se considera activo ahora", () => {
    // Un cliente que está marcando comidas está usando la app, aunque no haya
    // respondido un check-in ni pesado en semanas.
    assert.equal(
      lastActivityFor({
        lastResponseAt: daysAgo(40),
        entries: [],
        adherence: { daysWithData: 5 },
        now: NOW,
      }),
      NOW
    );
  });

  await t.test("adherencia con 0 días registrados NO cuenta como actividad", () => {
    const result = lastActivityFor({
      lastResponseAt: daysAgo(20),
      entries: [],
      adherence: { daysWithData: 0 },
      now: NOW,
    });
    assert.equal(result.getTime(), daysAgo(20).getTime());
  });

  await t.test("toma la más reciente entre check-in y última medida", () => {
    const result = lastActivityFor({
      lastResponseAt: daysAgo(20),
      entries: [{ date: isoDaysAgo(30) }, { date: isoDaysAgo(5) }],
      adherence: null,
      now: NOW,
    });
    // La medida de hace 5 días gana sobre el check-in de hace 20.
    assert.equal(result.toISOString().slice(0, 10), isoDaysAgo(5));
  });

  await t.test("solo medidas, sin check-ins -> la última medida", () => {
    const result = lastActivityFor({
      lastResponseAt: null,
      entries: [{ date: isoDaysAgo(12) }],
      adherence: null,
      now: NOW,
    });
    assert.equal(result.toISOString().slice(0, 10), isoDaysAgo(12));
  });
});

// La composición real que usa evaluateTrainer: montar snapshots y derivar
// de ellos las señales integradas.
function signalsFor(context, now) {
  return buildSignalsFromSnapshots(buildClientSnapshots(context, now));
}

test("señales integradas a partir de snapshots", async (t) => {
  // Forma mínima del contexto que devuelve loadTrainerContext.
  function context(overrides = {}) {
    return {
      activeClients: [],
      pendingReviewRelations: [],
      checkinByClient: new Map(),
      lastResponseByClient: new Map(),
      endingSoonByClient: new Map(),
      anthropometryByClient: new Map(),
      adherenceByClient: new Map(),
      // Fase 3 — los valores de check-in que alimentan las métricas de
      // bienestar del motor de reglas.
      checkinResponsesByClient: new Map(),
      // Ocurrencias de check-in: el denominador de la adherencia y la señal
      // de "no responde" desde que dejaron de deducirse de una cadencia.
      checkinRequestsByClient: new Map(),
      ...overrides,
    };
  }

  await t.test("un profesional sin clientes no produce señales", () => {
    assert.deepEqual(signalsFor(context(), NOW), []);
  });

  await t.test("cliente en revisión produce su señal con nombre completo", () => {
    const result = signalsFor(
      context({
        pendingReviewRelations: [
          { clientId: { _id: "c1", name: "Ana", lastname: "Ruiz" } },
        ],
      }),
      NOW
    );
    assert.equal(result.length, 1);
    assert.equal(result[0].clientName, "Ana Ruiz");
    assert.equal(result[0].signals[0].type, "pending_review");
    // La frase usa el nombre de pila, no el nombre completo.
    assert.match(result[0].signals[0].reason, /^Ana ha enviado/);
  });

  await t.test("relación sin usuario poblado se salta sin reventar", () => {
    const result = signalsFor(
      context({
        activeClients: [{ user: null, scopes: ["nutrition"] }],
        pendingReviewRelations: [{ clientId: null }],
      }),
      NOW
    );
    assert.deepEqual(result, []);
  });

  await t.test("cliente activo sin problemas aparece con lista de señales vacía", () => {
    const result = signalsFor(
      context({
        activeClients: [{ user: { _id: "c1", name: "Ok", lastname: "Bien" }, scopes: ["nutrition"] }],
        adherenceByClient: new Map([["c1", { percentage: 95, daysWithData: 20, periodDays: 28 }]]),
      }),
      NOW
    );
    assert.equal(result.length, 1);
    assert.deepEqual(result[0].signals, []);
  });

  await t.test("cruza antropometría, adherencia y check-in del cliente correcto", () => {
    const result = signalsFor(
      context({
        activeClients: [
          { user: { _id: "c1", name: "Juan", lastname: "Serra" }, scopes: ["nutrition"] },
          { user: { _id: "c2", name: "Eva", lastname: "Molina" }, scopes: ["nutrition"] },
        ],
        anthropometryByClient: new Map([
          ["c1", [{ date: isoDaysAgo(21), weight: 80 }, { date: isoDaysAgo(0), weight: 80.1 }]],
        ]),
        adherenceByClient: new Map([
          ["c1", { percentage: 91, daysWithData: 20, periodDays: 28 }],
          ["c2", { percentage: 40, daysWithData: 20, periodDays: 28 }],
        ]),
      }),
      NOW
    );

    const juan = result.find((r) => r.clientName === "Juan Serra");
    const eva = result.find((r) => r.clientName === "Eva Molina");

    // Juan: cumple pero no avanza -> estancamiento, NO baja adherencia.
    assert.ok(juan.signals.some((s) => s.type === "stagnation"));
    assert.ok(!juan.signals.some((s) => s.type === "low_adherence"));
    // Eva: no cumple -> baja adherencia, y NO estancamiento aunque no tenga
    // datos de peso (no se diagnostica la estrategia de quien no la sigue).
    assert.ok(eva.signals.some((s) => s.type === "low_adherence"));
    assert.ok(!eva.signals.some((s) => s.type === "stagnation"));
  });
});

test("ALERT_COOLDOWN_DAYS", async (t) => {
  await t.test("es un silencio real, ni nulo ni eterno", () => {
    assert.ok(ALERT_COOLDOWN_DAYS >= 1, "sin silencio, resolver una alerta no sirve de nada");
    assert.ok(ALERT_COOLDOWN_DAYS <= 30, "un silencio de más de un mes escondería problemas reales");
  });
});
