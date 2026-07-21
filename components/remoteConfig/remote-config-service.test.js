const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateMaintenanceStatus,
  calculateForceUpdate,
  validateConfigPatch,
} = require("./remote-config-service");

test("calculateMaintenanceStatus", async (t) => {
  await t.test("disabled -> normal regardless of dates", () => {
    const result = calculateMaintenanceStatus(
      { enabled: false, startAt: new Date("2020-01-01") },
      new Date("2020-01-01")
    );
    assert.equal(result.state, "normal");
  });

  await t.test("enabled, no dates at all -> active (instant/indefinite toggle)", () => {
    const result = calculateMaintenanceStatus({ enabled: true }, new Date());
    assert.equal(result.state, "active");
  });

  await t.test("enabled, startAt in the future, no endAt, no warningFrom -> normal", () => {
    const now = new Date("2024-01-01T00:00:00Z");
    const startAt = new Date("2024-01-10T00:00:00Z");
    const result = calculateMaintenanceStatus({ enabled: true, startAt }, now);
    assert.equal(result.state, "normal");
  });

  await t.test("enabled, startAt in the future, no endAt, past warningFrom -> warning", () => {
    const now = new Date("2024-01-05T00:00:00Z");
    const startAt = new Date("2024-01-10T00:00:00Z");
    const warningFrom = new Date("2024-01-03T00:00:00Z");
    const result = calculateMaintenanceStatus(
      { enabled: true, startAt, warningFrom, warningMessage: "soon" },
      now
    );
    assert.equal(result.state, "warning");
    assert.equal(result.message, "soon");
  });

  await t.test("enabled, startAt only, now past startAt, no endAt -> active indefinitely", () => {
    const now = new Date("2024-01-15T00:00:00Z");
    const startAt = new Date("2024-01-10T00:00:00Z");
    const result = calculateMaintenanceStatus({ enabled: true, startAt }, now);
    assert.equal(result.state, "active");
  });

  await t.test("enabled, now within [startAt, endAt] -> active", () => {
    const now = new Date("2024-01-15T00:00:00Z");
    const startAt = new Date("2024-01-10T00:00:00Z");
    const endAt = new Date("2024-01-20T00:00:00Z");
    const result = calculateMaintenanceStatus(
      { enabled: true, startAt, endAt, message: "down" },
      now
    );
    assert.equal(result.state, "active");
    assert.equal(result.message, "down");
  });

  await t.test("enabled, now past endAt -> normal even though enabled stays true (self-clears)", () => {
    const now = new Date("2024-01-25T00:00:00Z");
    const startAt = new Date("2024-01-10T00:00:00Z");
    const endAt = new Date("2024-01-20T00:00:00Z");
    const result = calculateMaintenanceStatus({ enabled: true, startAt, endAt }, now);
    assert.equal(result.state, "normal");
  });

  await t.test("boundary: now === startAt -> active (inclusive start)", () => {
    const startAt = new Date("2024-01-10T00:00:00Z");
    const endAt = new Date("2024-01-20T00:00:00Z");
    const result = calculateMaintenanceStatus(
      { enabled: true, startAt, endAt },
      new Date(startAt)
    );
    assert.equal(result.state, "active");
  });

  await t.test("boundary: now === endAt -> still active (inclusive through the instant of end)", () => {
    const startAt = new Date("2024-01-10T00:00:00Z");
    const endAt = new Date("2024-01-20T00:00:00Z");
    const result = calculateMaintenanceStatus(
      { enabled: true, startAt, endAt },
      new Date(endAt)
    );
    assert.equal(result.state, "active");
  });
});

test("calculateForceUpdate", async (t) => {
  const forceUpdate = {
    minVersionIos: "2.0.0",
    minVersionAndroid: "2.1.0",
    minVersionWeb: "2.2.0",
    message: "please update",
  };

  await t.test("client version below minimum -> required", () => {
    const result = calculateForceUpdate(forceUpdate, "1.9.9", "ios");
    assert.equal(result.required, true);
    assert.equal(result.message, "please update");
  });

  await t.test("client version equal to minimum -> not required", () => {
    const result = calculateForceUpdate(forceUpdate, "2.0.0", "ios");
    assert.equal(result.required, false);
  });

  await t.test("client version above minimum -> not required", () => {
    const result = calculateForceUpdate(forceUpdate, "2.5.0", "ios");
    assert.equal(result.required, false);
  });

  await t.test("per-platform minimum is respected", () => {
    const belowAndroidOnly = calculateForceUpdate(forceUpdate, "2.0.5", "android");
    assert.equal(belowAndroidOnly.required, true);

    const aboveIos = calculateForceUpdate(forceUpdate, "2.0.5", "ios");
    assert.equal(aboveIos.required, false);
  });

  await t.test("web: client version below minimum -> required", () => {
    const result = calculateForceUpdate(forceUpdate, "2.1.9", "web");
    assert.equal(result.required, true);
  });

  await t.test("web: client version at or above minimum -> not required", () => {
    const result = calculateForceUpdate(forceUpdate, "2.2.0", "web");
    assert.equal(result.required, false);
  });

  await t.test("unknown platform -> fail-open, not required", () => {
    const result = calculateForceUpdate(forceUpdate, "1.0.0", "desktop");
    assert.equal(result.required, false);
  });

  await t.test("invalid client version string -> fail-open, not required", () => {
    const result = calculateForceUpdate(forceUpdate, "not-a-version", "ios");
    assert.equal(result.required, false);
  });

  await t.test("missing min version for platform -> fail-open, not required", () => {
    const result = calculateForceUpdate(
      { minVersionIos: "", minVersionAndroid: "2.1.0" },
      "1.0.0",
      "ios"
    );
    assert.equal(result.required, false);
  });

  await t.test("no forceUpdate config at all -> fail-open, not required", () => {
    const result = calculateForceUpdate(null, "1.0.0", "ios");
    assert.equal(result.required, false);
  });
});

test("validateConfigPatch", async (t) => {
  await t.test("valid full patch -> no errors", () => {
    const errors = validateConfigPatch({
      maintenance: {
        warningFrom: new Date("2024-01-01"),
        startAt: new Date("2024-01-05"),
        endAt: new Date("2024-01-10"),
      },
      forceUpdate: { minVersionIos: "1.2.3", minVersionAndroid: "1.2.4" },
    });
    assert.deepEqual(errors, []);
  });

  await t.test("warningFrom without startAt -> error", () => {
    const errors = validateConfigPatch({
      maintenance: { warningFrom: new Date("2024-01-01") },
    });
    assert.ok(errors.length > 0);
  });

  await t.test("endAt without startAt -> error", () => {
    const errors = validateConfigPatch({
      maintenance: { endAt: new Date("2024-01-10") },
    });
    assert.ok(errors.length > 0);
  });

  await t.test("startAt after endAt -> error", () => {
    const errors = validateConfigPatch({
      maintenance: {
        startAt: new Date("2024-01-10"),
        endAt: new Date("2024-01-05"),
      },
    });
    assert.ok(errors.length > 0);
  });

  await t.test("invalid semver min version -> error", () => {
    const errors = validateConfigPatch({
      forceUpdate: { minVersionIos: "not-a-version" },
    });
    assert.ok(errors.length > 0);
  });

  await t.test("invalid semver min version for web -> error", () => {
    const errors = validateConfigPatch({
      forceUpdate: { minVersionWeb: "not-a-version" },
    });
    assert.ok(errors.length > 0);
  });
});
