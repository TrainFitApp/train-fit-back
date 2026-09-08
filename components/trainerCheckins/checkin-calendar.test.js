const { test, afterEach, mock } = require("node:test");
const assert = require("node:assert/strict");
const dates = require("./checkin-schedule-dates");
const service = require("./checkin-calendar-service");
const controller = require("./checkin-calendar-controller");
const Schedule = require("./checkin-schedule-schema");
const Request = require("./checkin-request-schema");
const Response = require("./checkin-response-schema");
const Notification = require("../notifications/notification-schema");
const relations = require("../trainerClients/trainer-client-dao");
const anthropometry = require("../anthropometry/anthropometry-dao");
const { isCheckinDue } = require("./checkin-due");
const timing = { startDate: "2026-03-22", time: "09:00", timeZone: "Europe/Madrid", frequency: "weekly", interval: 1 };
const query = value => ({ lean: async () => value });
const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
const schedule = { ...timing, _id: id, clientId: "client", trainerId: "trainer", active: true, revision: 0, enabledFields: ["weight"], name: "Peso semanal", nextRunAt: new Date("2026-03-22T08:00:00Z") };
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, send(body) { this.body = body; return this; }, sendStatus(code) { this.statusCode = code; return this; } });
afterEach(() => mock.restoreAll());

test("fechas fijas mantienen las 09:00 locales al cambiar el horario", () => {
  assert.equal(dates.occurrenceAt(timing, 0).toISOString(), "2026-03-22T08:00:00.000Z");
  assert.equal(dates.occurrenceAt(timing, 1).toISOString(), "2026-03-29T07:00:00.000Z");
  assert.equal(dates.nextOccurrence(timing, new Date("2026-03-27T19:00Z")).toISOString(), "2026-03-29T07:00:00.000Z");
  assert.equal(dates.zonedInstant("2026-03-29", "02:30", "Europe/Madrid").toISOString(), "2026-03-29T01:30:00.000Z");
  assert.equal(dates.zonedInstant("2026-10-25", "02:30", "Europe/Madrid").toISOString(), "2026-10-25T00:30:00.000Z");
});

test("mensual conserva el día 31 y contempla febrero bisiesto y el intervalo máximo", () => {
  const monthly = { ...timing, startDate: "2028-01-31", frequency: "monthly" };
  assert.equal(dates.calendarDate(dates.occurrenceAt(monthly, 1), monthly.timeZone), "2028-02-29");
  assert.equal(dates.calendarDate(dates.occurrenceAt(monthly, 2), monthly.timeZone), "2028-03-31");
  const sparse = { ...monthly, interval: 52 };
  assert.equal(dates.calendarDate(dates.nextOccurrence(sparse, dates.occurrenceAt(sparse, 0)), sparse.timeZone), "2032-05-31");
  assert.equal(dates.nextOccurrence({ ...timing, frequency: "once" }, dates.occurrenceAt(timing, 0)), null);
});

test("rechaza fechas y frecuencias inválidas y usa la fecha de la zona elegida", () => {
  for (const change of [{ startDate: "2026-02-30" }, { time: "24:00" }, { interval: 0 }, { interval: 1.5 }, { frequency: "random" }, { timeZone: "wrong" }]) assert.ok(dates.validateTiming({ ...timing, ...change }));
  assert.equal(dates.validateTiming(timing), null);
  assert.equal(dates.calendarDate(new Date("2026-09-08T23:30Z"), "Europe/Madrid"), "2026-09-09");
});

test("el cierre es exclusivo: al abrir el siguiente el anterior queda sin responder", () => {
  const request = { status: "pending", scheduledAt: new Date("2026-03-22T08:00Z"), closesAt: new Date("2026-03-29T07:00Z") };
  assert.equal(service.requestIsOpen(request, new Date("2026-03-29T06:59:59Z")), true);
  assert.equal(service.requestIsOpen(request, request.closesAt), false);
  assert.equal(service.visibleStatus(request, request.closesAt), "unanswered");
  assert.equal(service.visibleStatus({ ...request, status: "responded" }, request.closesAt), "responded");
});

test("valida la instantánea, no acepta campos ajenos ni escalas fuera de rango", () => {
  const request = { enabledFields: ["weight", "urine_color"], customQuestions: [{ _id: "effort", label: "Esfuerzo", type: "scale_1_5", required: true, enabled: true }] };
  assert.ok(service.validateAnswers(request, { weight: 80 }).error);
  assert.ok(service.validateAnswers(request, { "custom:effort": 6 }).error);
  assert.ok(service.validateAnswers(request, { "custom:effort": 3, stress_level: 2 }).error);
  assert.ok(service.validateAnswers(request, { "custom:effort": 3, urine_color: 9 }).error);
  assert.deepEqual(service.validateAnswers(request, { "custom:effort": 3, urine_color: 8, weight: 80 }).values, { "custom:effort": 3, urine_color: 8, weight: 80 });
});

test("recupera ciclos atrasados sin duplicarlos y sólo deja abierta la última solicitud", async () => {
  const stored = new Map();
  let current = { ...schedule };
  mock.method(Schedule, "findOneAndUpdate", () => query(current));
  mock.method(Schedule, "updateOne", async (_filter, update) => { if ("nextRunAt" in update.$set) current.nextRunAt = update.$set.nextRunAt; });
  mock.method(relations, "findActiveByTrainerAndClient", async () => ({}));
  mock.method(Request, "updateOne", async (filter, update) => { if (!stored.has(filter.occurrenceKey)) stored.set(filter.occurrenceKey, update.$setOnInsert); });
  mock.method(Request, "updateMany", async () => ({}));
  const now = new Date("2026-04-06T10:00Z");
  await service.materialize(schedule, now);
  await service.materialize(schedule, now);
  assert.equal(stored.size, 3);
  assert.deepEqual([...stored.values()].map(r => r.status), ["unanswered", "unanswered", "pending"]);
  assert.equal(current.nextRunAt.toISOString(), "2026-04-12T07:00:00.000Z");
});

test("un bloqueo ocupado no crea solicitudes y se libera incluso si falla el trabajo", async () => {
  mock.method(Schedule, "findOneAndUpdate", () => query(null));
  assert.deepEqual(await service.withScheduleLock(id, () => assert.fail("No debe ejecutar")), { conflict: true });
  mock.method(Schedule, "findOneAndUpdate", () => query(schedule));
  const released = mock.method(Schedule, "updateOne", async () => ({}));
  await assert.rejects(service.withScheduleLock(id, async () => { throw new Error("fallo simulado"); }), /simulado/);
  assert.equal(released.mock.calls[0].arguments[1].$set.leaseUntil, null);
  assert.ok(released.mock.calls[0].arguments[0].leaseToken);
});

test("pedir ahora reutiliza la solicitud abierta y no desplaza el calendario", async () => {
  const current = { ...schedule, nextRunAt: new Date("2026-04-12T07:00Z") };
  const pending = { _id: "open", status: "pending" };
  mock.method(Schedule, "findOneAndUpdate", () => query(current));
  const updates = mock.method(Schedule, "updateOne", async () => ({}));
  mock.method(Request, "findOne", () => query(pending));
  assert.equal(await service.requestNow(current, "manual-request-1234", new Date("2026-04-06T10:00Z")), pending);
  assert.equal(updates.mock.calls.some(c => "nextRunAt" in c.arguments[1].$set), false);
});

test("revisar es explícito, del profesional propietario e idempotente", async () => {
  const reviewed = { _id: id, status: "reviewed", reviewComment: "Buen trabajo" };
  const atomic = mock.method(Request, "findOneAndUpdate", () => query(null));
  const retry = mock.method(Request, "findOne", () => query(reviewed));
  mock.method(service, "projectAnswer", async () => {});
  const res = response();
  await controller.review({ auth: { userId: "owner" }, params: { clientId: "client", requestId: id }, body: { comment: " Buen trabajo " } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(atomic.mock.calls[0].arguments[0].trainerId, "owner");
  assert.equal(atomic.mock.calls[0].arguments[0].status, "responded");
  assert.equal(retry.mock.calls[0].arguments[0].reviewComment, "Buen trabajo");
});

test("un cliente sólo responde su solicitud y el cierre se comprueba en la escritura", async () => {
  const request = { ...schedule, enabledFields: ["weight"], status: "pending", scheduledAt: new Date(), closesAt: new Date() };
  const read = mock.method(Request, "findOne", () => query(request));
  mock.method(relations, "findActiveByTrainerAndClient", async () => ({}));
  const write = mock.method(Request, "findOneAndUpdate", () => query(null));
  const res = response();
  await controller.respond({ auth: { userId: "client" }, params: { requestId: id }, body: { values: { weight: 80 } } }, res);
  assert.equal(read.mock.calls[0].arguments[0].clientId, "client");
  assert.equal(write.mock.calls[0].arguments[0].clientId, "client");
  assert.ok(write.mock.calls[0].arguments[0].$or[1].closesAt.$gt instanceof Date);
  assert.equal(res.statusCode, 409);
});

test("la revisión no vuelve a escribir medidas y los avisos usan claves idempotentes", async () => {
  const request = { ...schedule, values: { weight: 80 }, respondedAt: new Date(), updatedAt: new Date(), status: "reviewed", reviewedAt: new Date(), anthropometryProjectedAt: new Date() };
  mock.method(Response, "updateOne", async () => ({}));
  mock.method(Request, "updateOne", async () => ({}));
  const notice = mock.method(Notification, "findOneAndUpdate", async () => ({}));
  const merge = mock.method(anthropometry, "mergeCheckinFields", async () => ({}));
  await service.projectAnswer(request);
  assert.equal(merge.mock.callCount(), 0);
  assert.deepEqual(notice.mock.calls.map(c => c.arguments[0].dedupeKey), [`checkin_responded:${id}`, `checkin_reviewed:${id}`]);
});

test("un formulario independiente no reinicia la cadencia del anterior", () => {
  assert.equal(isCheckinDue({ cadence: "weekly" }, [{ scheduleId: id, respondedAt: new Date() }]), true);
  assert.equal(isCheckinDue({ calendarManaged: true }, []), false);
});
