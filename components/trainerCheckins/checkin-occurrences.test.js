const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeOccurrences, isAnswered, isClosedUnanswered, isOpen } = require("./checkin-occurrences");

const NOW = new Date("2026-09-09T12:00:00.000Z");
const hace = (dias) => new Date(NOW.getTime() - dias * 86400000);

// Este reparto es el denominador de la adherencia de check-ins, la columna
// "vencido" de la Cartera y la alerta de "no responde". Los tres tienen que
// contar lo mismo, y por eso viven en un solo módulo.

test("estado de una ocurrencia", async (t) => {
  await t.test("respondida y revisada cuentan igual", () => {
    assert.equal(isAnswered({ status: "responded" }), true);
    assert.equal(isAnswered({ status: "reviewed" }), true);
    assert.equal(isAnswered({ status: "pending" }), false);
  });

  await t.test("cerrada sin responder: por fecha de cierre o por estado", () => {
    assert.equal(isClosedUnanswered({ status: "pending", closesAt: hace(1) }, NOW), true);
    assert.equal(isClosedUnanswered({ status: "unanswered", closesAt: null }, NOW), true);
    assert.equal(isClosedUnanswered({ status: "pending", closesAt: hace(-3) }, NOW), false);
  });

  // Sin fecha de cierre no se cierra sola: es el "cuando puedas" de una
  // solicitud puntual, y cerrarla por su cuenta la convertiría en un fallo
  // que nadie ha cometido.
  await t.test("una solicitud sin cierre se queda abierta", () => {
    assert.equal(isOpen({ status: "pending", closesAt: null }, NOW), true);
    assert.equal(isClosedUnanswered({ status: "pending", closesAt: null }, NOW), false);
  });

  await t.test("cancelada no está ni abierta ni perdida", () => {
    const cancelada = { status: "cancelled", closesAt: hace(1) };
    assert.equal(isOpen(cancelada, NOW), false);
    assert.equal(isClosedUnanswered(cancelada, NOW), false);
    assert.equal(isAnswered(cancelada), false);
  });
});

test("reparto de una ventana", async (t) => {
  await t.test("separa respondidas, perdidas y abiertas", () => {
    const resumen = summarizeOccurrences(
      [
        { scheduledAt: hace(21), closesAt: hace(14), status: "responded" },
        { scheduledAt: hace(14), closesAt: hace(7), status: "pending" },
        { scheduledAt: hace(7), closesAt: hace(0), status: "reviewed" },
        { scheduledAt: hace(1), closesAt: hace(-6), status: "pending" },
      ],
      NOW
    );
    assert.deepEqual(resumen, { answered: 2, missed: 1, open: 1, resolved: 3 });
  });

  await t.test("una ocurrencia futura todavía no se le debe a nadie", () => {
    const resumen = summarizeOccurrences(
      [{ scheduledAt: hace(-2), closesAt: hace(-9), status: "pending" }],
      NOW
    );
    assert.deepEqual(resumen, { answered: 0, missed: 0, open: 0, resolved: 0 });
  });

  await t.test("sin ocurrencias no hay nada que repartir", () => {
    assert.deepEqual(summarizeOccurrences([], NOW), { answered: 0, missed: 0, open: 0, resolved: 0 });
    assert.deepEqual(summarizeOccurrences(undefined, NOW), { answered: 0, missed: 0, open: 0, resolved: 0 });
  });
});
