// PURO: asunto y texto del aviso de renovación anual (30 y 7 días antes). El HTML lo pone util/mail.
const PLAN_NAMES = { free: "Free", starter: "Inicio", professional: "Profesional", scale: "Escala" };
const DATE = new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Madrid" });
const EUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

function buildRenewalReminder({ stage, at, amount, tier, seats, manageUrl, supportEmail }) {
  const plan = PLAN_NAMES[tier] || "Trainers";
  const date = DATE.format(new Date(at));
  const subject = stage === 7
    ? `Tu plan anual de TrainFit Trainers se renueva en 7 días (${date})`
    : `Tu plan anual de TrainFit Trainers se renueva el ${date}`;
  const price = typeof amount === "number" ? ` Importe previsto: ${EUR.format(amount / 100)}.` : "";
  const help = supportEmail ? ` ¿Dudas con la facturación? Escríbenos a ${supportEmail}.` : "";
  const capacity = Number.isInteger(seats) ? ` (${seats} plazas de clientes)` : "";
  const description = `Tu plan ${plan} anual${capacity} se renovará automáticamente el ${date}.${price} ` +
    "Si no quieres renovarlo, cancela la renovación desde Mi cuenta → Suscripción antes de esa fecha: " +
    `mantendrás el acceso hasta el final del periodo pagado.${help}`;
  return { subject, title: "Renovación de tu plan anual", description, linkHref: manageUrl, linkContent: "Gestionar suscripción" };
}

module.exports = { buildRenewalReminder };
