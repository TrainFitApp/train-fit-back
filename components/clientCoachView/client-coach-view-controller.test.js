const test = require("node:test");
const assert = require("node:assert/strict");
const { isCheckinDue } = require("./client-coach-view-controller");

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000);
}

// coach-tab Fase 1/2 — isCheckinDue decide si un check-in aparece como
// "pendiente" en el dashboard del cliente. Cubre las 3 cadencias soportadas
// (weekly/biweekly/once) y sus límites — una regresión aquí haría que el
// cliente deje de ver (o vea de más) check-ins pendientes.
test("isCheckinDue", async (t) => {
  await t.test("nunca respondido -> siempre pendiente, cualquier cadencia", () => {
    assert.equal(isCheckinDue({ cadence: "weekly" }, []), true);
    assert.equal(isCheckinDue({ cadence: "biweekly" }, []), true);
    assert.equal(isCheckinDue({ cadence: "once" }, []), true);
  });

  await t.test("weekly: respondido hace 6 días -> NO pendiente", () => {
    assert.equal(isCheckinDue({ cadence: "weekly" }, [{ respondedAt: daysAgo(6) }]), false);
  });

  await t.test("weekly: respondido hace exactamente 7 días -> SÍ pendiente (límite inclusivo)", () => {
    assert.equal(isCheckinDue({ cadence: "weekly" }, [{ respondedAt: daysAgo(7) }]), true);
  });

  await t.test("weekly: respondido hace 10 días -> pendiente", () => {
    assert.equal(isCheckinDue({ cadence: "weekly" }, [{ respondedAt: daysAgo(10) }]), true);
  });

  await t.test("biweekly: respondido hace 10 días -> NO pendiente todavía", () => {
    assert.equal(isCheckinDue({ cadence: "biweekly" }, [{ respondedAt: daysAgo(10) }]), false);
  });

  await t.test("biweekly: respondido hace 14 días -> pendiente", () => {
    assert.equal(isCheckinDue({ cadence: "biweekly" }, [{ respondedAt: daysAgo(14) }]), true);
  });

  await t.test('once: respondido una vez (hace 1 día) -> nunca vuelve a estar pendiente', () => {
    assert.equal(isCheckinDue({ cadence: "once" }, [{ respondedAt: daysAgo(1) }]), false);
  });

  await t.test('once: respondido hace mucho tiempo (200 días) -> sigue sin estar pendiente', () => {
    assert.equal(isCheckinDue({ cadence: "once" }, [{ respondedAt: daysAgo(200) }]), false);
  });

  await t.test("responses ya viene ordenado desc por respondedAt: solo se mira responses[0]", () => {
    const responses = [{ respondedAt: daysAgo(1) }, { respondedAt: daysAgo(30) }];
    assert.equal(isCheckinDue({ cadence: "weekly" }, responses), false);
  });

  await t.test("cadencia desconocida cae al default de 7 días (weekly)", () => {
    assert.equal(isCheckinDue({ cadence: "monthly" }, [{ respondedAt: daysAgo(6) }]), false);
    assert.equal(isCheckinDue({ cadence: "monthly" }, [{ respondedAt: daysAgo(7) }]), true);
  });
});
