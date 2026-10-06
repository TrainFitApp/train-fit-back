const test = require("node:test");
const assert = require("node:assert/strict");
const { pickProfile, pointerChanges } = require("./user-profile");

const NOW = new Date("2026-10-06T10:00:00Z");

test("pickProfile: solo la lista blanca; los punteros solo si se piden", () => {
  const body = { name: "Ana", password: "x", roles: ["admin"], tableInUse: "t1" };
  assert.deepEqual(pickProfile(body), { name: "Ana" });
  assert.deepEqual(pickProfile(body, { pointers: true }), { name: "Ana", tableInUse: "t1" });
});

test("pointerChanges: repetir la rutina y la sesión en uso no escribe nada", () => {
  const current = { tableInUse: "t1", workoutInUse: "w1" };
  assert.deepEqual(pointerChanges({ tableInUse: "t1", workoutInUse: "w1" }, current, NOW), { set: {}, unset: [] });
  assert.deepEqual(pointerChanges({}, current, NOW), { set: {}, unset: [] });
});

test("pointerChanges: cambiar de rutina la elige y suelta la sesión a medias", () => {
  const changes = pointerChanges({ tableInUse: "t2", workoutInUse: "w1" }, { tableInUse: "t1", workoutInUse: "w1" }, NOW);
  assert.deepEqual(changes, { set: { tableInUse: "t2", tableInUseAt: NOW }, unset: ["workoutInUse", "workoutInUseAt"] });
});

test("pointerChanges: cambiar de rutina y elegir sesión en la misma escritura", () => {
  const changes = pointerChanges({ tableInUse: "t2", workoutInUse: "w9" }, { tableInUse: "t1", workoutInUse: "w1" }, NOW);
  assert.deepEqual(changes.set, { tableInUse: "t2", tableInUseAt: NOW, workoutInUse: "w9", workoutInUseAt: NOW });
  assert.deepEqual(changes.unset, []);
});

test("pointerChanges: empezar o terminar una sesión", () => {
  assert.deepEqual(pointerChanges({ workoutInUse: "w2" }, { tableInUse: "t1", workoutInUse: null }, NOW), {
    set: { workoutInUse: "w2", workoutInUseAt: NOW },
    unset: [],
  });
  assert.deepEqual(pointerChanges({ workoutInUse: null }, { tableInUse: "t1", workoutInUse: "w2" }, NOW), {
    set: {},
    unset: ["workoutInUse", "workoutInUseAt"],
  });
});

test("pointerChanges: quitar la rutina elegida", () => {
  assert.deepEqual(pointerChanges({ tableInUse: null }, { tableInUse: "t1", workoutInUse: null }, NOW), {
    set: {},
    unset: ["tableInUse", "tableInUseAt", "workoutInUse", "workoutInUseAt"],
  });
});
