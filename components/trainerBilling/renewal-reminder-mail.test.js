const test = require("node:test");
const assert = require("node:assert/strict");
const { buildRenewalReminder } = require("./renewal-reminder-mail");

test("the annual renewal reminder states date, expected amount, how to cancel and who to ask", () => {
  const base = { at: new Date("2027-03-18T10:00:00Z"), amount: 35937, tier: "trainer_growth",
    manageUrl: "https://trainers.example.test/tabs/subscription", supportEmail: "facturacion@example.test" };
  const month = buildRenewalReminder({ ...base, stage: 30 });
  assert.equal(month.subject, "Tu plan anual de TrainFit Trainers se renueva el 18 de marzo de 2027");
  assert.match(month.description, /Tu plan Growth anual se renovará automáticamente el 18 de marzo de 2027\./);
  assert.match(month.description, /Importe previsto: 359,37\s€\./);
  assert.match(month.description, /cancela la renovación desde Mi cuenta → Suscripción antes de esa fecha/);
  assert.match(month.description, /facturacion@example\.test/);
  assert.equal(month.linkHref, "https://trainers.example.test/tabs/subscription");
  const week = buildRenewalReminder({ ...base, stage: 7, amount: null, supportEmail: null });
  assert.equal(week.subject, "Tu plan anual de TrainFit Trainers se renueva en 7 días (18 de marzo de 2027)");
  assert.doesNotMatch(week.description, /Importe previsto/, "without Stripe's estimate the email never invents an amount");
  assert.doesNotMatch(week.description, /Escríbenos/);
});
