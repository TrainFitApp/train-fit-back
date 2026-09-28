const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../.build/trainer-payments");

// Reglas de negocio del núcleo puro (sin BD). Los índices, la atomicidad real
// y el job se prueban aparte contra un Mongo aislado (trainer-payments-db.test.js).

let seq = 0;
const newId = () => (++seq).toString(16).padStart(24, "0");
const ctxAt = (today, now = new Date(`${today}T10:00:00.000Z`)) => ({ today, now, actorId: "a".repeat(24), newId });

function makeCharge(overrides = {}) {
  return core.normalizeCharge({
    id: newId(),
    trainerId: "t".repeat(24),
    clientId: "c".repeat(24),
    schemaVersion: 2,
    origin: "one_off",
    currency: "EUR",
    dueDay: "2026-11-05",
    amountCents: 6000,
    originalAmountCents: 6000,
    receivedCents: 0,
    cancelledCents: 0,
    status: "open",
    payments: [],
    adjustments: [],
    operations: [],
    revision: 1,
    dueRevision: 1,
    remindersFrom: new Date("2026-10-01T00:00:00Z"),
    reminderLog: [],
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  });
}

function pay(charge, amount, receivedDay, operationId, today = "2026-11-12") {
  const input = core.parsePaymentBody({ amount, receivedDay, method: "bizum", operationId });
  return core.registerPayment(charge, input, ctxAt(today));
}

function emptyProfile(id = "p".repeat(24)) {
  return {
    id,
    trainerId: "t".repeat(24),
    clientId: "c".repeat(24),
    plan: null,
    clientReminders: { enabled: false, enabledAt: null, disabledAt: null, disabledReason: null },
    reminderOffsets: null,
    operations: [],
    revision: 0,
  };
}

// Materializa lo que la puesta al día crearía para `today` (sin BD).
function materialize(profile, existing, today) {
  const keys = new Set(existing.map((charge) => charge.planOccurrenceKey));
  const created = core
    .materializationTargets(profile, today)
    .filter((target) => !keys.has(target.key))
    .map((target) =>
      makeCharge({
        origin: "recurring",
        dueDay: target.day,
        amountCents: target.amountCents,
        originalAmountCents: target.amountCents,
        concept: target.concept,
        planOccurrenceKey: target.key,
        planSegment: target.segment,
      }),
    );
  return [...existing, ...created];
}

test("importes: céntimos exactos y como mucho dos decimales", () => {
  assert.equal(core.parseAmountToCents("40"), 4000);
  assert.equal(core.parseAmountToCents("40,5"), 4050);
  assert.equal(core.parseAmountToCents("40.55"), 4055);
  assert.equal(core.parseAmountToCents(19.99), 1999);
  for (const bad of ["10.005", 0, -1, "abc", "1.000,00", 1e9, null]) {
    assert.throws(() => core.parseAmountToCents(bad), { code: "INVALID_AMOUNT" }, String(bad));
  }
});

test("calendario: 31 → fin de febrero (bisiesto o no) → 31 de marzo", () => {
  const monthly = core.validateRecurrence("month", 1, "2027-01-31");
  assert.deepEqual(core.nextOccurrences(monthly, "2027-01-31", 3).map((o) => o.day), ["2027-01-31", "2027-02-28", "2027-03-31"]);
  const leap = core.validateRecurrence("month", 1, "2028-01-31");
  assert.deepEqual(core.nextOccurrences(leap, "2028-02-01", 2).map((o) => o.day), ["2028-02-29", "2028-03-31"]);
  const quarterly = core.validateRecurrence("month", 3, "2026-11-30");
  assert.deepEqual(core.nextOccurrences(quarterly, "2026-12-01", 2).map((o) => o.day), ["2027-02-28", "2027-05-30"]);
});

test("calendario: cada 4 semanas no es mensual", () => {
  const fourWeeks = core.validateRecurrence("week", 4, "2026-10-05");
  const monthly = core.validateRecurrence("month", 1, "2026-10-05");
  assert.deepEqual(core.nextOccurrences(fourWeeks, "2026-10-05", 3).map((o) => o.day), ["2026-10-05", "2026-11-02", "2026-11-30"]);
  assert.deepEqual(core.nextOccurrences(monthly, "2026-10-05", 3).map((o) => o.day), ["2026-10-05", "2026-11-05", "2026-12-05"]);
  assert.throws(() => core.validateRecurrence("week", 53, "2026-10-05"), { code: "INVALID_FREQUENCY" });
  assert.throws(() => core.validateRecurrence("month", 0, "2026-10-05"), { code: "INVALID_FREQUENCY" });
});

test("zona: hoy y hora de aviso por día civil, con cambio de hora", () => {
  // 22:30 UTC del día 4 ya es día 5 en Madrid.
  assert.equal(core.civilDayInZone(new Date("2026-10-04T22:30:00Z"), "Europe/Madrid"), "2026-10-05");
  assert.equal(core.civilDayInZone(new Date("2026-10-04T22:30:00Z"), "UTC"), "2026-10-04");
  // 09:00 en Madrid antes y después del cambio de octubre.
  assert.equal(core.instantForZonedTime("2026-10-24", "09:00", "Europe/Madrid").toISOString(), "2026-10-24T07:00:00.000Z");
  assert.equal(core.instantForZonedTime("2026-10-25", "09:00", "Europe/Madrid").toISOString(), "2026-10-25T08:00:00.000Z");
  assert.equal(core.instantForZonedTime("2026-03-29", "09:00", "Europe/Madrid").toISOString(), "2026-03-29T07:00:00.000Z");
  // Hora inexistente (salto de primavera): cae después del salto.
  assert.equal(core.instantForZonedTime("2026-03-29", "02:30", "Europe/Madrid").toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(core.isValidTimeZone("Europe/Madrid"), true);
  assert.equal(core.isValidTimeZone("+01:00"), false);
  assert.equal(core.isValidTimeZone("Mars/Olympus"), false);
});

test("hoy no es vencido: solo al día siguiente en la zona configurada", () => {
  const charge = makeCharge({ dueDay: "2026-11-05" });
  assert.equal(core.temporalState(charge, "2026-11-05"), "due_today");
  assert.equal(core.isOverdue(charge, "2026-11-05"), false);
  assert.equal(core.temporalState(charge, "2026-11-06"), "overdue");
});

test("aceptación 4: 60 - 20 = 40 y un segundo pago de 40 liquida conservando ambos", () => {
  let charge = makeCharge();
  const first = pay(charge, "20", "2026-11-07", "op-first-0001");
  charge = first.charge;
  assert.equal(core.balanceOf(charge), 4000);
  assert.equal(charge.status, "open");
  charge = pay(charge, 40, "2026-11-12", "op-second-001").charge;
  assert.equal(core.balanceOf(charge), 0);
  assert.equal(charge.status, "settled");
  assert.equal(core.validMovements(charge).length, 2);
  assert.deepEqual(core.verifyCharge(charge), []);
  assert.throws(() => pay(charge, 1, "2026-11-12", "op-third-0001"), { code: "CHARGE_CLOSED" });
});

test("aceptación 5: 100 con 30 recibidos y el resto anulado → recibido 30, anulado 70, pendiente 0", () => {
  let charge = makeCharge({ amountCents: 10000, originalAmountCents: 10000 });
  charge = pay(charge, 30, "2026-11-07", "op-pay-30-001").charge;
  assert.throws(
    () => core.cancelBalance(charge, { reason: "Acuerdo con el cliente", operationId: "op-cancel-001", confirmBalanceCents: 6000 }, ctxAt("2026-11-12")),
    { code: "BALANCE_CHANGED" },
  );
  const result = core.cancelBalance(charge, { reason: "Acuerdo con el cliente", operationId: "op-cancel-001", confirmBalanceCents: 7000 }, ctxAt("2026-11-12"));
  charge = result.charge;
  assert.equal(charge.receivedCents, 3000);
  assert.equal(charge.cancelledCents, 7000);
  assert.equal(core.balanceOf(charge), 0);
  assert.equal(charge.status, "cancelled");
  assert.equal(core.validMovements(charge).length, 1, "cancelar no crea un pago");
  assert.deepEqual(core.verifyCharge(charge), []);
});

test("pagos: sin sobrepago, sin fecha futura y con idempotencia persistente", () => {
  let charge = makeCharge();
  assert.throws(() => pay(charge, 61, "2026-11-07", "op-over-00001"), { code: "AMOUNT_EXCEEDS_BALANCE" });
  assert.throws(() => pay(charge, 10, "2026-11-13", "op-future-001", "2026-11-12"), { code: "FUTURE_RECEIVED_DAY" });
  assert.throws(() => pay(charge, 10, "2026-11-07", "short"), { code: "INVALID_OPERATION_ID" });
  charge = pay(charge, 20, "2026-11-07", "op-same-00001").charge;
  const replay = pay(charge, 20, "2026-11-07", "op-same-00001");
  assert.equal(replay.kind, "replay");
  assert.equal(replay.charge.receivedCents, 2000, "el reintento no duplica");
  assert.throws(() => pay(charge, 25, "2026-11-07", "op-same-00001"), { code: "IDEMPOTENCY_CONFLICT" });
  // Pago recibido el mes pasado, anotado hoy: cuenta en el mes de recepción.
  const late = pay(charge, 10, "2026-10-28", "op-late-00001").movement;
  assert.equal(late.receivedDay, "2026-10-28");
  assert.equal(late.recordedAt.toISOString().slice(0, 10), "2026-11-12");
});

test("dos pagos concurrentes sobre la misma revisión: el segundo se recalcula y no puede exceder", () => {
  const base = pay(makeCharge(), 20, "2026-11-07", "op-base-00001").charge; // saldo 40
  const a = pay(base, 30, "2026-11-08", "op-conc-a-001");
  // La escritura de B falla el CAS (misma revisión) y se recalcula sobre el estado de A.
  assert.equal(a.charge.revision, base.revision + 1);
  assert.throws(() => pay(a.charge, 30, "2026-11-08", "op-conc-b-001"), { code: "AMOUNT_EXCEEDS_BALANCE" });
});

test("corrección: conserva el original, exige motivo y confirma la reapertura", () => {
  let charge = pay(makeCharge(), 60, "2026-11-07", "op-full-00001").charge;
  const original = charge.payments[0];
  const ctx = ctxAt("2026-11-12");
  const body = {
    reason: "Eran 50, no 60",
    operationId: "op-fix-000001",
    replacement: { amount: 50, receivedDay: "2026-11-07", method: "cash" },
  };
  assert.throws(() => core.correctPayment(charge, original.id, { ...body, reason: "" }, ctx), { code: "INVALID_TEXT" });
  assert.throws(() => core.correctPayment(charge, original.id, body, ctx), (error) => {
    assert.equal(error.code, "REOPEN_CONFIRMATION_REQUIRED");
    assert.equal(error.details.balanceCents, 1000);
    return true;
  });
  const result = core.correctPayment(charge, original.id, { ...body, confirmBalanceCents: 1000 }, ctx);
  charge = result.charge;
  assert.equal(result.reopened, true);
  assert.equal(charge.status, "open");
  assert.equal(charge.receivedCents, 5000);
  assert.equal(charge.payments.length, 2);
  assert.equal(charge.payments[0].status, "voided");
  assert.equal(charge.payments[1].correctionOf, original.id);
  assert.equal(charge.remindersFrom.getTime(), ctx.now.getTime(), "reabrir no dispara hitos antiguos");
  assert.deepEqual(core.verifyCharge(charge), []);
  const replay = core.correctPayment(charge, original.id, { ...body, confirmBalanceCents: 1000 }, ctx);
  assert.equal(replay.kind, "replay");
});

test("anulaciones: pagos + anulado nunca superan el importe; rectificar exige confirmar", () => {
  let charge = makeCharge({ amountCents: 10000, originalAmountCents: 10000 });
  charge = pay(charge, 30, "2026-11-07", "op-pay-a-0001").charge;
  charge = core.cancelBalance(charge, { reason: "Descuento", operationId: "op-can-a-0001", confirmBalanceCents: 7000 }, ctxAt("2026-11-12")).charge;
  const ctx = ctxAt("2026-11-12");
  assert.throws(
    () => core.editCharge(charge, { amount: 90, reason: "Precio real", operationId: "op-edit-a-001" }, ctx),
    { code: "AMOUNT_BELOW_RECORDED" },
  );
  assert.throws(
    () => core.correctPayment(charge, charge.payments[0].id, { reason: "Error", operationId: "op-fix-a-0001", replacement: { amount: 40, receivedDay: "2026-11-07", method: "cash" } }, ctx),
    { code: "AMOUNT_EXCEEDS_BALANCE" },
  );
  assert.throws(
    () => core.restoreCancelled(charge, { amount: 20, reason: "No hubo descuento", operationId: "op-rest-a-001" }, ctx),
    { code: "REOPEN_CONFIRMATION_REQUIRED" },
  );
  charge = core.restoreCancelled(charge, { amount: 20, reason: "No hubo descuento", operationId: "op-rest-a-001", confirmBalanceCents: 2000 }, ctx).charge;
  assert.equal(charge.status, "open");
  assert.equal(charge.cancelledCents, 5000);
  assert.equal(core.balanceOf(charge), 2000);
  assert.deepEqual(core.verifyCharge(charge), []);
});

test("editar vencimiento: nueva revisión de hitos y trazabilidad", () => {
  const ctx = ctxAt("2026-11-01");
  const charge = makeCharge();
  assert.throws(() => core.editCharge(charge, { dueDay: "2026-11-10", operationId: "op-due-00001" }, ctx), /motivo/);
  const result = core.editCharge(charge, { dueDay: "2026-11-10", reason: "Cobra a fin de semana", operationId: "op-due-00001" }, ctx);
  assert.equal(result.dueChanged, true);
  assert.equal(result.charge.dueRevision, charge.dueRevision + 1);
  assert.equal(result.charge.remindersFrom.getTime(), ctx.now.getTime());
  assert.equal(result.charge.adjustments.at(-1).type, "due_changed");
});

function monthlyPlan(today, firstDue = "2026-10-05", amount = 60) {
  const change = core.planChange(
    emptyProfile(),
    [],
    { amount, unit: "month", interval: 1, nextDueDay: firstDue, operationId: `op-plan-${firstDue}` },
    ctxAt(today),
  );
  return change.profile;
}

test("aceptación 1-2: cuota del día 5 pagada el 12 sigue venciendo el 5; la deuda no se sustituye", () => {
  let profile = monthlyPlan("2026-10-01");
  let charges = materialize(profile, [], "2026-10-01");
  assert.deepEqual(charges.map((c) => c.dueDay), ["2026-10-05"]);
  charges = [pay(charges[0], 60, "2026-10-12", "op-late-pay01", "2026-10-12").charge];
  charges = materialize(profile, charges, "2026-10-30");
  assert.deepEqual(charges.map((c) => c.dueDay), ["2026-10-05", "2026-11-05"]);
  // Sin pagar noviembre, diciembre se genera aparte y noviembre sigue ahí.
  charges = materialize(profile, charges, "2026-11-30");
  assert.deepEqual(charges.map((c) => c.dueDay), ["2026-10-05", "2026-11-05", "2026-12-05"]);
  assert.equal(charges[1].status, "open");
  // Rematerializar el mismo día no duplica (misma clave de ocurrencia).
  assert.equal(materialize(profile, charges, "2026-11-30").length, 3);
  // Previsualización de tres fechas antes de guardar.
  assert.deepEqual(core.previewDates(profile.plan, "2026-10-01").map((d) => d.day), ["2026-10-05", "2026-11-05", "2026-12-05"]);
  assert.throws(
    () => core.planChange(emptyProfile(), [], { amount: 60, unit: "month", interval: 1, nextDueDay: "2026-09-30", operationId: "op-past-plan1" }, ctxAt("2026-10-01")),
    { code: "START_IN_PAST" },
  );
});

test("aceptación 10: precio nuevo desde el vencimiento elegido, con o sin previsión materializada", () => {
  const body = { amount: 70, unit: "month", interval: 1, effectiveFromDay: "2026-11-05", operationId: "op-price-0001" };
  // A) Todavía sin materializar noviembre.
  const profileA = monthlyPlan("2026-10-01");
  const chargesA = materialize(profileA, [], "2026-10-01");
  const changeA = core.planChange(profileA, chargesA, body, ctxAt("2026-10-01"));
  assert.deepEqual(changeA.changes, ["price"]);
  const afterA = materialize(changeA.profile, chargesA, "2026-10-30");
  // B) Noviembre ya estaba materializado a 60 cuando se cambia el precio.
  const profileB = monthlyPlan("2026-10-01");
  const chargesB = materialize(profileB, [], "2026-10-30");
  const changeB = core.planChange(profileB, chargesB, body, ctxAt("2026-10-30"));
  const reconciled = core.reconcileCharges(changeB.profile, chargesB, "2026-10-30", ctxAt("2026-10-30"));
  assert.equal(reconciled.reprices.length, 1);
  const novB = reconciled.reprices[0].after;
  const novA = afterA.find((c) => c.dueDay === "2026-11-05");
  assert.equal(novA.amountCents, 7000);
  assert.equal(novB.amountCents, 7000, "mismo resultado aunque ya se hubiera materializado");
  assert.equal(novB.adjustments.at(-1).type, "price_change");
  // Octubre (vencido) conserva su importe.
  assert.equal(chargesB.find((c) => c.dueDay === "2026-10-05").amountCents, 6000);
  // Un vencimiento futuro con pagos queda protegido.
  const prepaid = pay(chargesB.find((c) => c.dueDay === "2026-11-05"), 10, "2026-10-30", "op-prepay-001", "2026-10-30").charge;
  const protectedRun = core.reconcileCharges(changeB.profile, [chargesB[0], prepaid], "2026-10-30", ctxAt("2026-10-30"));
  assert.equal(protectedRun.reprices.length, 0);
  assert.deepEqual(protectedRun.protectedCharges.map((p) => p.reason), ["has_movements"]);
  assert.throws(
    () => core.planChange(profileA, chargesA, { ...body, effectiveFromDay: "2026-11-06", operationId: "op-price-0002" }, ctxAt("2026-10-01")),
    { code: "INVALID_EFFECTIVE_DAY" },
  );
});

test("aceptación 11: pausa y reanudación sin cuotas del intervalo pausado, la deuda sigue", () => {
  const profile = monthlyPlan("2026-10-01");
  let charges = materialize(profile, [], "2026-10-30"); // octubre (vencido) + previsión de noviembre
  const paused = core.pausePlan(profile, { operationId: "op-pause-0001" }, ctxAt("2026-10-30"));
  const reconciled = core.reconcileCharges(paused.profile, charges, "2026-10-30", ctxAt("2026-10-30"));
  assert.deepEqual(reconciled.voids.map((c) => [c.dueDay, c.voidReason]), [["2026-11-05", "plan_paused"]]);
  charges = charges.map((c) => reconciled.voids.find((v) => v.id === c.id) || c);
  assert.equal(charges[0].status, "open", "la deuda de octubre se conserva");
  assert.equal(core.materializationTargets(paused.profile, "2026-12-20").length, 0);
  assert.throws(
    () => core.resumePlan(paused.profile, charges, { nextDueDay: "2026-10-05", operationId: "op-resume-001" }, ctxAt("2026-12-20")),
    { code: "START_IN_PAST" },
  );
  const resumed = core.resumePlan(paused.profile, charges, { nextDueDay: "2027-01-05", operationId: "op-resume-001" }, ctxAt("2026-12-20"));
  assert.equal(resumed.profile.plan.segment, paused.profile.plan.segment + 1);
  const after = materialize(resumed.profile, charges, "2027-01-01");
  assert.deepEqual(after.filter((c) => c.status !== "void").map((c) => c.dueDay), ["2026-10-05", "2027-01-05"]);
  // Idempotencia de la operación de reanudar.
  assert.equal(core.resumePlan(resumed.profile, charges, { nextDueDay: "2027-01-05", operationId: "op-resume-001" }, ctxAt("2026-12-20")).mode, "replay");
});

test("finalizar la cuota no borra obligaciones; reactivar abre un segmento nuevo", () => {
  const profile = monthlyPlan("2026-10-01");
  const charges = materialize(profile, [], "2026-10-30");
  const ended = core.endPlan(profile, { operationId: "op-end-000001" }, "trainer", ctxAt("2026-10-30"));
  assert.equal(ended.profile.plan.status, "ended");
  const reconciled = core.reconcileCharges(ended.profile, charges, "2026-10-30", ctxAt("2026-10-30"));
  assert.deepEqual(reconciled.voids.map((c) => c.voidReason), ["plan_ended"]);
  assert.equal(charges[0].status, "open");
  const again = core.planChange(ended.profile, charges, { amount: 65, unit: "week", interval: 4, nextDueDay: "2026-11-02", operationId: "op-react-0001" }, ctxAt("2026-10-30"));
  assert.equal(again.mode, "reactivate");
  assert.equal(again.profile.plan.segment, 2);
});

test("avisos: -3/0/+3 a las 09:00 de Madrid, solo el hito vigente tras una caída", () => {
  const settings = core.DEFAULT_REMINDER_SETTINGS;
  const charge = makeCharge({ dueDay: "2026-11-05", remindersFrom: new Date("2026-10-01T00:00:00Z") });
  const before = core.decideReminders(charge, "trainer", settings, new Date("2026-11-02T08:10:00Z"), charge.remindersFrom);
  assert.deepEqual([before.emit.offset, before.skip.length], [-3, 0]);
  assert.equal(before.emit.instant.toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(core.decideReminders(charge, "trainer", settings, new Date("2026-11-02T07:59:00Z"), charge.remindersFrom).emit, null);
  // Sin abrir la app del 1 al 9: solo +3, los anteriores omitidos.
  const recovered = core.decideReminders(charge, "trainer", settings, new Date("2026-11-09T09:00:00Z"), charge.remindersFrom);
  assert.equal(recovered.emit.offset, 3);
  assert.deepEqual(recovered.skip.map((m) => m.offset), [-3, 0]);
  // Ya registrado: no se repite.
  const logged = { ...charge, reminderLog: [{ key: "trainer:1:3", recipient: "trainer", dueRevision: 1, offset: 3, state: "sent", at: new Date() }, { key: "trainer:1:-3", recipient: "trainer", dueRevision: 1, offset: -3, state: "skipped", at: new Date() }, { key: "trainer:1:0", recipient: "trainer", dueRevision: 1, offset: 0, state: "skipped", at: new Date() }] };
  assert.equal(core.decideReminders(logged, "trainer", settings, new Date("2026-11-20T09:00:00Z"), charge.remindersFrom).emit, null);
  // Sin saldo: nada.
  const settled = pay(charge, 60, "2026-11-01", "op-set-000001", "2026-11-01").charge;
  assert.equal(core.decideReminders(settled, "trainer", settings, new Date("2026-11-09T09:00:00Z"), charge.remindersFrom).emit, null);
});

test("avisos del cliente: activar no reproduce el histórico; cambiar zona no repite hitos", () => {
  const settings = core.DEFAULT_REMINDER_SETTINGS;
  const charge = makeCharge({ dueDay: "2026-11-05" });
  const enabledAt = new Date("2026-11-06T12:00:00Z");
  const start = core.windowStartFor(charge, "client", enabledAt);
  const decision = core.decideReminders(charge, "client", settings, new Date("2026-11-06T12:05:00Z"), start);
  assert.equal(decision.emit, null);
  assert.deepEqual(decision.skip.map((m) => m.offset), [-3, 0]);
  const later = core.decideReminders(charge, "client", settings, new Date("2026-11-08T08:30:00Z"), start);
  assert.equal(later.emit.offset, 3);
  // Cambio a Nueva York: el día civil no cambia y el hito -3 ya registrado no vuelve.
  const ny = { ...settings, timeZone: "America/New_York" };
  const withLog = { ...charge, reminderLog: [{ key: "trainer:1:-3", recipient: "trainer", dueRevision: 1, offset: -3, state: "sent", at: new Date() }] };
  const afterChange = core.decideReminders(withLog, "trainer", ny, new Date("2026-11-03T15:00:00Z"), charge.remindersFrom);
  assert.equal(afterChange.emit, null);
  assert.equal(withLog.dueDay, "2026-11-05");
  assert.equal(core.milestoneInstant("2026-11-05", 0, ny).toISOString(), "2026-11-05T14:00:00.000Z");
});

test("legacy: fechas y pagos antiguos se conservan sin inventar precisión", () => {
  const paid = core.normalizeCharge({
    id: newId(), trainerId: "t".repeat(24), clientId: "c".repeat(24),
    amount: 60, currency: "EUR", dueDate: new Date("2026-09-05T00:00:00Z"), paidAt: new Date("2026-09-07T10:00:00Z"), note: "sept", createdAt: new Date("2026-09-01T10:00:00Z"),
  });
  assert.equal(paid.dueDay, "2026-09-05");
  assert.equal(paid.status, "settled");
  assert.equal(paid.payments.length, 1);
  assert.deepEqual(
    [paid.payments[0].method, paid.payments[0].receivedDaySource, paid.payments[0].recordedAt, paid.payments[0].source],
    ["unknown", "legacy_marked_paid", null, "migration"],
  );
  assert.equal(paid.persistedV2, false);
  const madridMidnight = core.normalizeCharge({ id: newId(), trainerId: "t", clientId: "c", amount: 10, dueDate: new Date("2026-09-04T22:00:00Z") });
  assert.equal(madridMidnight.dueDay, "2026-09-05");
  assert.deepEqual(madridMidnight.anomalies, []);
  const ambiguous = core.normalizeCharge({ id: newId(), trainerId: "t", clientId: "c", amount: 10, dueDate: new Date("2026-09-05T23:30:00Z") });
  assert.deepEqual(ambiguous.anomalies, ["ambiguous_due_date"]);
  const usd = core.normalizeCharge({ id: newId(), trainerId: "t", clientId: "c", amount: 10.005, currency: "usd", dueDate: new Date("2026-09-05T00:00:00Z") });
  assert.deepEqual(usd.anomalies.sort(), ["amount_precision", "non_eur_currency"]);
});

test("migración: convierte lo limpio, reporta anomalías y los totales no cambian", () => {
  const migratedAt = new Date("2026-10-01T03:00:00Z");
  const records = [
    { id: newId(), trainerId: "t", clientId: "c", amount: 60, currency: "EUR", dueDate: new Date("2026-09-05T00:00:00Z"), paidAt: new Date("2026-09-07T10:00:00Z"), createdAt: new Date("2026-09-01") },
    { id: newId(), trainerId: "t", clientId: "c", amount: 45.5, currency: "EUR", dueDate: new Date("2026-10-05T00:00:00Z"), paidAt: null, createdAt: new Date("2026-09-01") },
    { id: newId(), trainerId: "t", clientId: "c", amount: 20, currency: "USD", dueDate: new Date("2026-10-05T00:00:00Z"), paidAt: null, createdAt: new Date("2026-09-01") },
  ];
  const plans = records.map((record) => core.planMigration(record, migratedAt));
  assert.deepEqual(plans.map((p) => p.action), ["convert", "convert", "skip"]);
  assert.deepEqual(plans[2].anomalies, ["non_eur_currency"]);
  assert.equal(plans[0].charge.remindersFrom.getTime(), migratedAt.getTime(), "sin avisos retroactivos");
  const before = core.ledgerTotals(records.map((record) => core.normalizeCharge(record)));
  const after = core.ledgerTotals(plans.map((p) => p.charge));
  assert.deepEqual(after, before);
  assert.deepEqual(before.EUR, { charges: 2, amountCents: 10550, receivedCents: 6000, pendingCents: 4550, movements: 1 });
  // Segunda pasada: ya migrado, nada que hacer.
  const second = core.planMigration({ ...records[0], schemaVersion: 2, amountCents: 6000, receivedCents: 6000, dueDay: "2026-09-05", status: "settled", payments: plans[0].charge.payments }, migratedAt);
  assert.equal(second.action, "skip");
  assert.equal(second.reason, "already_migrated");
});

test("PATCH legacy: paid:true repetido no duplica; paid:false no borra un historial parcial", () => {
  const ctx = ctxAt("2026-11-12");
  let charge = makeCharge();
  const decision = core.legacyToggle(charge, true, ctx.today);
  assert.equal(decision.kind, "pay");
  assert.equal(decision.input.method, "unknown");
  charge = core.registerPayment(charge, decision.input, ctx, { source: "legacy_toggle", receivedDaySource: "legacy_marked_paid" }).charge;
  assert.equal(charge.status, "settled");
  assert.equal(core.legacyToggle(charge, true, ctx.today).kind, "noop");
  const unmark = core.legacyToggle(charge, false, ctx.today);
  assert.equal(unmark.kind, "unmark");
  const reopened = core.unmarkLegacyPayment(charge, unmark.movement, ctx);
  assert.equal(reopened.status, "open");
  assert.equal(reopened.payments[0].status, "voided", "el rastro se conserva");
  // Parcial registrado con la app nueva.
  const partial = pay(makeCharge(), 20, "2026-11-07", "op-part-00001").charge;
  assert.equal(core.legacyToggle(partial, false, ctx.today).kind, "noop");
  const full = pay(partial, 40, "2026-11-08", "op-part-00002").charge;
  assert.throws(() => core.legacyToggle(full, false, ctx.today), { code: "LEGACY_CONFLICT" });
  const cancelled = core.cancelBalance(partial, { reason: "Regalo", operationId: "op-canc-00001", confirmBalanceCents: 4000 }, ctx).charge;
  assert.throws(() => core.legacyToggle(cancelled, true, ctx.today), { code: "LEGACY_CONFLICT" });
});

test("DTO legacy y Coach: saldo real tras un parcial, sin notas hacia el cliente", () => {
  const partial = pay(makeCharge({ note: "Privada" }), 20, "2026-11-07", "op-dto-000001").charge;
  const legacy = core.legacyListItem(partial);
  assert.equal(legacy.amount, 40);
  assert.equal(legacy.paidAt, null);
  assert.equal(legacy.dueDate.toISOString(), "2026-11-05T12:00:00.000Z");
  const coach = core.coachPendingItem(partial, "Laura Coach");
  assert.equal(coach.amount, 40);
  assert.equal("note" in coach, false);
  assert.equal(core.isLegacyListable(core.cancelBalance(partial, { reason: "Regalo", operationId: "op-dto-000002", confirmBalanceCents: 4000 }, ctxAt("2026-11-12")).charge), false);
});

test("tarjeta del Resumen: la deuda manda sobre la pausa y no hay falsos vacíos", () => {
  const today = "2026-11-10";
  assert.equal(core.clientPaymentsSummary([], null, today).state, "no_fee");
  const profile = monthlyPlan("2026-10-01");
  assert.equal(core.clientPaymentsSummary([], profile.plan, "2026-10-01").state, "upcoming");
  const overdue = makeCharge({ dueDay: "2026-11-05", amountCents: 6000 });
  const paused = core.pausePlan(profile, { operationId: "op-card-pause" }, ctxAt(today)).profile.plan;
  const withDebt = core.clientPaymentsSummary([pay(overdue, 20, "2026-11-07", "op-card-00001").charge], paused, today);
  assert.equal(withDebt.state, "overdue");
  assert.deepEqual(withDebt.overdue, { balanceCents: 4000, count: 1, oldestDueDay: "2026-11-05" });
  assert.equal(core.clientPaymentsSummary([], paused, today).state, "paused");
  const dueToday = core.clientPaymentsSummary([makeCharge({ dueDay: today })], null, today);
  assert.equal(dueToday.state, "due_today");
  const oneOff = core.clientPaymentsSummary([makeCharge({ dueDay: "2026-12-01" })], null, today);
  assert.equal(oneOff.state, "upcoming");
  assert.equal(oneOff.next.origin, "one_off");
  const closed = core.clientPaymentsSummary([pay(makeCharge(), 60, "2026-11-07", "op-card-00002").charge], null, today);
  assert.equal(closed.state, "no_pending");
});

test("invariante: cualquier secuencia de operaciones deja agregado = movimientos y saldo >= 0", () => {
  let rng = 7;
  const random = () => ((rng = (rng * 48271) % 2147483647) / 2147483647);
  for (let round = 0; round < 60; round += 1) {
    let charge = makeCharge({ amountCents: 10000, originalAmountCents: 10000 });
    for (let step = 0; step < 8; step += 1) {
      const ctx = { ...ctxAt("2026-11-12"), now: new Date(Date.UTC(2026, 10, 12, 10, round, step)) };
      const pick = random();
      try {
        if (pick < 0.45) {
          const amount = Math.max(1, Math.round(random() * 6000)) / 100;
          charge = core.registerPayment(charge, core.parsePaymentBody({ amount, receivedDay: "2026-11-10", method: "cash", operationId: `op-r${round}-s${step}-p` }), ctx).charge;
        } else if (pick < 0.65 && core.validMovements(charge).length) {
          const target = core.validMovements(charge)[0];
          const replacement = random() < 0.5 ? null : { amount: Math.max(1, Math.round(random() * 3000)) / 100, receivedDay: "2026-11-09", method: "transfer" };
          const probe = { reason: "Ajuste", operationId: `op-r${round}-s${step}-c`, replacement };
          try {
            charge = core.correctPayment(charge, target.id, probe, ctx).charge;
          } catch (error) {
            if (error.code !== "REOPEN_CONFIRMATION_REQUIRED") throw error;
            charge = core.correctPayment(charge, target.id, { ...probe, confirmBalanceCents: error.details.balanceCents }, ctx).charge;
          }
        } else if (pick < 0.8 && charge.status === "open") {
          charge = core.cancelBalance(charge, { reason: "Anulado", operationId: `op-r${round}-s${step}-x`, confirmBalanceCents: core.balanceOf(charge) }, ctx).charge;
        } else if (charge.cancelledCents > 0) {
          const amount = Math.max(1, Math.round(random() * charge.cancelledCents)) / 100;
          const cents = core.parseAmountToCents(amount);
          const confirm = charge.amountCents - charge.receivedCents - (charge.cancelledCents - cents);
          charge = core.restoreCancelled(charge, { amount, reason: "Rectificado", operationId: `op-r${round}-s${step}-u`, confirmBalanceCents: confirm }, ctx).charge;
        }
      } catch (error) {
        if (!["AMOUNT_EXCEEDS_BALANCE", "CHARGE_CLOSED", "AMOUNT_EXCEEDS_CANCELLED"].includes(error.code)) throw error;
      }
      assert.deepEqual(core.verifyCharge(charge), [], `ronda ${round} paso ${step}`);
    }
  }
});
