const test = require("node:test");
const assert = require("node:assert/strict");
const { noteAuthorRole, stripForeignWorkoutNotes, canWritePinnedNote } = require("./note-authorship");

test("noteAuthorRole", async (t) => {
  await t.test("el dueño de la tabla escribe como cliente", () => {
    assert.equal(noteAuthorRole("u1", "u1"), "client");
  });

  await t.test("compara como string (ObjectId vs string)", () => {
    assert.equal(noteAuthorRole({ toString: () => "u1" }, "u1"), "client");
  });

  await t.test("cualquier otro escribe como entrenador", () => {
    assert.equal(noteAuthorRole("coach", "u1"), "trainer");
  });
});

test("stripForeignWorkoutNotes", async (t) => {
  const body = { _id: "w1", notes: "del entrenador", clientNotes: "del cliente", paused: true };

  await t.test("cliente en rutina asignada: no toca notes", () => {
    const clean = stripForeignWorkoutNotes(body, { authorRole: "client", trainerManaged: true });
    assert.equal("notes" in clean, false);
    assert.equal(clean.clientNotes, "del cliente");
    assert.equal(clean.paused, true);
  });

  await t.test("cliente sin entrenador: notes sigue siendo suya", () => {
    const clean = stripForeignWorkoutNotes(body, { authorRole: "client", trainerManaged: false });
    assert.equal(clean.notes, "del entrenador");
    assert.equal(clean.clientNotes, "del cliente");
  });

  await t.test("entrenador: nunca toca clientNotes", () => {
    const clean = stripForeignWorkoutNotes(body, { authorRole: "trainer", trainerManaged: true });
    assert.equal(clean.notes, "del entrenador");
    assert.equal("clientNotes" in clean, false);
  });

  await t.test("no muta el body original", () => {
    stripForeignWorkoutNotes(body, { authorRole: "trainer", trainerManaged: true });
    assert.equal(body.clientNotes, "del cliente");
  });
});

test("canWritePinnedNote", async (t) => {
  await t.test("posición libre", () => {
    assert.equal(canWritePinnedNote(null, "client"), true);
  });

  await t.test("nota anterior a authorRole: cualquiera", () => {
    assert.equal(canWritePinnedNote({ notes: "x" }, "client"), true);
    assert.equal(canWritePinnedNote({ notes: "x", authorRole: null }, "trainer"), true);
  });

  await t.test("la propia sí, la del otro no", () => {
    assert.equal(canWritePinnedNote({ authorRole: "trainer" }, "trainer"), true);
    assert.equal(canWritePinnedNote({ authorRole: "trainer" }, "client"), false);
    assert.equal(canWritePinnedNote({ authorRole: "client" }, "trainer"), false);
  });
});
