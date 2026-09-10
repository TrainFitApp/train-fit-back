const test = require("node:test");
const assert = require("node:assert/strict");
const { groupRelations, normalizeMeasurements, normalizeContext, validateMeasurementFields, validDate, fingerprint } = require("./overview-domain");
const date = (s) => new Date(s);
const relation = (id, start, end, scope = "training") => ({ _id: id, clientId: "client", trainerId: "trainer", scope, respondedAt: date(start), invitedAt: date(start), revokedAt: end ? date(end) : null, status: end ? "revoked" : "active" });

test("adding a scope and revoking one does not restart the stage", () => {
  const groups = groupRelations([relation("a", "2026-01-01", "2026-04-01"), relation("b", "2026-02-01", null, "nutrition")]);
  assert.equal(groups.length, 1); assert.equal(groups[0].end, Infinity); assert.equal(groups[0].relations.length, 2);
});
test("return after all scopes ended creates a separate stage", () => {
  const groups = groupRelations([relation("a", "2026-01-01", "2026-03-01"), relation("b", "2026-02-01", "2026-04-01", "nutrition"), relation("c", "2026-06-01", null)]);
  assert.equal(groups.length, 2); assert.equal(groups[1].key, "c"); assert.equal(groups[0].end, date("2026-04-01").getTime());
});
test("health/context changes and unaccepted invitations cannot manufacture a new stage", () => {
  const groups = groupRelations([relation("a", "2026-01-01", null), { ...relation("b", "2026-06-01", null), status: "pending" }]);
  assert.equal(groups.length, 1); assert.equal(groups[0].relations.length, 1);
});
test("unknown legacy revocation date is marked estimated, never connected to a later return", () => {
  const groups = groupRelations([{ ...relation("a", "2026-01-01", null), status: "revoked" }, relation("b", "2026-06-01", null)]);
  assert.equal(groups.length, 2); assert.equal(groups[0].estimated, true);
});
test("civil dates reject rollovers and future dates; missing fields never become zero", () => {
  assert.equal(validDate("2026-02-29"), false); assert.equal(validDate("2024-02-29"), true);
  assert.deepEqual(normalizeMeasurements([], "2026-09-10"), []);
  for (const value of [0, -2, NaN, Infinity, "80"]) assert.throws(() => normalizeMeasurements([{ field: "weight", value, date: "2026-09-01" }], "2026-09-10"));
  assert.throws(() => normalizeMeasurements([{ field: "weight", value: 80, date: "2026-09-11" }], "2026-09-10"));
});
test("measurement references keep independent dates and explicit reuse", () => {
  const result = normalizeMeasurements([{ field: "weight", value: 80, date: "2026-09-01", confirmedExisting: true }, { field: "waist", value: 90, date: "2026-09-05" }], "2026-09-10");
  assert.equal(result[0].date, "2026-09-01"); assert.equal(result[0].confirmedExisting, true); assert.equal(result[1].date, "2026-09-05");
  assert.throws(() => normalizeMeasurements([...result, result[0]], "2026-09-10"));
});
test("context allowlist cannot modify credentials, scopes or prototype fields", () => {
  for (const field of ["email", "password", "roles", "subscription", "trainerId", "stageId", "__proto__"]) assert.throws(() => normalizeContext(JSON.parse(`{"${field}":"bad"}`)));
  assert.deepEqual(normalizeContext({ goals: "  Ganar fuerza  ", trainingLocation: "home", equipmentTags: ["bands"] }), { goals: "Ganar fuerza", trainingLocation: "home", equipmentTags: ["bands"] });
  assert.throws(() => normalizeContext({ equipmentTags: ["unverified"] }));
});
test("measurement configuration only accepts existing canonical keys", () => {
  assert.deepEqual(validateMeasurementFields(["weight", "waist", "weight"]), ["weight", "waist"]);
  assert.throws(() => validateMeasurementFields(["armLeft"])); assert.throws(() => validateMeasurementFields(["password"]));
});
test("review fingerprint detects backdated edits and is stable across object key order", () => {
  assert.equal(fingerprint({ date: "2026-01-01", weight: 80 }), fingerprint({ weight: 80, date: "2026-01-01" }));
  assert.notEqual(fingerprint({ date: "2026-01-01", weight: 80 }), fingerprint({ date: "2026-01-01", weight: 79 }));
});
