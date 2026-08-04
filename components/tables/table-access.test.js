const test = require("node:test");
const assert = require("node:assert/strict");
const { isAdmin, isTrainer, canAccessUserTable } = require("./table-access");

// Replanteamiento MVP (rutinas) — table-access.js es la única comprobación
// de "¿puede este request leer/mutar la tabla de este dueño?" reutilizada
// por table/split/workout/customExercise/set controllers. Una regresión aquí
// reabriría el hueco (cualquier "user"/"trainer" mutando la tabla de otro) o
// rompería el acceso legítimo del profesional a sus propios clientes.
// Los casos que no requieren BD (admin, dueño real, sin rol habilitante) se
// cubren aquí; el camino "profesional con relación activa" se verifica con
// BD real en el script de QA desechable (requiere trainerClientDao).

function makeReq({ roles = [], userId = "user1" } = {}) {
  return { userData: { roles }, user: { id: userId } };
}

test("isAdmin", async (t) => {
  await t.test("roles incluye admin -> true", () => {
    assert.equal(isAdmin(makeReq({ roles: ["admin"] })), true);
  });
  await t.test("roles no incluye admin -> false", () => {
    assert.equal(isAdmin(makeReq({ roles: ["user"] })), false);
  });
  await t.test("sin userData -> false", () => {
    assert.equal(isAdmin({}), false);
  });
});

test("isTrainer", async (t) => {
  await t.test("roles incluye trainer -> true", () => {
    assert.equal(isTrainer(makeReq({ roles: ["trainer"] })), true);
  });
  await t.test("roles no incluye trainer -> false", () => {
    assert.equal(isTrainer(makeReq({ roles: ["user"] })), false);
  });
});

test("canAccessUserTable", async (t) => {
  await t.test("sin ownerUserId -> false", async () => {
    assert.equal(await canAccessUserTable(makeReq({ roles: ["user"] }), null), false);
  });

  await t.test("admin -> true aunque no sea el dueño", async () => {
    assert.equal(
      await canAccessUserTable(makeReq({ roles: ["admin"], userId: "admin1" }), "otroUsuario"),
      true,
    );
  });

  await t.test("dueño real (mismo userId) -> true", async () => {
    assert.equal(
      await canAccessUserTable(makeReq({ roles: ["user"], userId: "cliente1" }), "cliente1"),
      true,
    );
  });

  await t.test("usuario normal que no es el dueño ni admin ni trainer -> false", async () => {
    assert.equal(
      await canAccessUserTable(makeReq({ roles: ["user"], userId: "otroCliente" }), "cliente1"),
      false,
    );
  });
});
