const test = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { errorTrace } = require("./adapter");

test("el log de un fallo inesperado dice qué falló (clase, código, petición) y nunca el mensaje", () => {
  const stripe = new Stripe.errors.StripePermissionError({ message: "The provided key 'rk_test_secret' does not have access",
    type: "invalid_request_error", requestId: "req_perm123" });
  const trace = errorTrace(stripe);
  assert.match(trace, /^StripePermissionError/);
  assert.match(trace, /req_perm123/);
  assert.ok(!trace.includes("rk_test_secret"), "el mensaje de Stripe no llega al log");

  const mongo = Object.assign(new Error("user trainer@example.test not authorized"), { name: "MongoServerError", code: 13, codeName: "Unauthorized" });
  assert.equal(errorTrace(mongo), "MongoServerError Unauthorized");
  assert.equal(errorTrace(Object.assign(new Error("x"), { code: "con espacios y datos" })), "Error", "solo códigos con forma de código");
  assert.equal(errorTrace(undefined), "undefined");
});
