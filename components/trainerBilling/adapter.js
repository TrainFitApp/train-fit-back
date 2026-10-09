// Adaptador CommonJS del backend existente. La lógica de negocio vive en TS strict.
let runtime;
// Aviso de renovación anual (30 y 7 días antes) por el canal transaccional existente (util/mail).
const notifier = {
  async renewalReminder(input) {
    const { sendTransactionalMail, generateMail } = require("../util/mail");
    const mail = require("./renewal-reminder-mail").buildRenewalReminder(input);
    const html = generateMail(mail.title, mail.description, mail.linkHref, mail.linkContent);
    await sendTransactionalMail(input.email, mail.subject, html, input.supportEmail ? { replyTo: input.supportEmail } : {});
  },
};
function getRuntime() {
  if (runtime) return runtime;
  const { createRuntime } = require("../../.build/trainer-billing/runtime");
  const User = require("../users/user-schema");
  runtime = createRuntime({
    seatUsage: (id) => require("../trainerClients/trainer-client-dao").countSeats(id),
    async getUser(id) {
      const user = await User.findById(id).select("email").lean();
      return user ? { id: String(user._id), email: user.email } : null;
    },
    async project(account, value) {
      // Fencing: una escritura antigua nunca puede sobrescribir una proyección nueva.
      await User.updateOne({ _id: account.userId, $or: [
        { "professionalPremium.stripeRevision": { $exists: false } },
        { "professionalPremium.stripeRevision": { $lte: value.stripeRevision } },
      ] }, { $set: { professionalPremium: value } });
    },
  }, notifier);
  return runtime;
}

function adminUserId(value) {
  if (typeof value === "string" && /^[a-f0-9]{24}$/.test(value)) return value;
  const { BillingError } = require("../../.build/trainer-billing/types");
  throw new BillingError("INVALID_USER", "Entrenador no válido.", 400);
}

// Plan, plazas (contratadas, ocupadas, reservadas y libres) y estado de la facturación.
async function getEntitlements(userId) {
  const User = require("../users/user-schema");
  const featureAccess = require("../billing/feature-access");
  const trainerClientDao = require("../trainerClients/trainer-client-dao");
  const { billingMetadata, admissionSeats } = require("../../.build/trainer-billing/runtime");
  const user = await User.findById(userId).select("professionalPremium").lean();
  const usage = await trainerClientDao.countSeats(userId);
  const current = getRuntime();
  const account = await current.repository.get(String(userId));
  const plan = featureAccess.trainerPlan(user);
  // Con una bajada programada, las altas nuevas ya cuentan con las plazas del destino.
  const admission = admissionSeats(plan.seats, account);
  return { isPremium: plan.paid, tier: plan.tier, interval: plan.interval, expiresAt: plan.expiresAt,
    seats: { capacity: plan.seats, occupied: usage.occupied, reserved: usage.reserved, admission,
      available: Math.max(0, admission - usage.occupied - usage.reserved) },
    ...billingMetadata(current.config, account) };
}

function sendError(res, error) {
  const { BillingError } = require("../../.build/trainer-billing/types");
  if (error instanceof BillingError) return res.status(error.status).json({ code: error.code, message: error.message });
  // Stripe/Mongo errors may carry request payloads. Never expose/log them.
  console.error("[TrainerBilling] Operation failed; retry or inspect provider dashboard.");
  return res.status(503).json({ code: "BILLING_UNAVAILABLE", message: "No se ha podido completar la operación de facturación. Inténtalo de nuevo." });
}

function handler(action) {
  return async (req, res) => {
    res.set("Cache-Control", "no-store");
    try { return res.json(await action(req)); }
    catch (error) { return sendError(res, error); }
  };
}
const controller = {
  plans: handler(() => getRuntime().service.plans()),
  entitlements: handler((req) => getEntitlements(String(req.user._id))),
  checkout: handler((req) => getRuntime().service.checkout(String(req.user._id), req.body)),
  portal: handler((req) => getRuntime().service.portal(String(req.user._id))),
  billingDetails: handler((req) => getRuntime().service.billingDetails(String(req.user._id))),
  changePreview: handler((req) => getRuntime().service.previewChange(String(req.user._id), req.body)),
  changePlan: handler(async (req) => {
    const result = await getRuntime().service.changePlan(String(req.user._id), req.body?.quoteId, req.body?.termsUrl);
    return { ...result, entitlements: await getEntitlements(String(req.user._id)) };
  }),
  cancel: handler(async (req) => {
    await getRuntime().service.cancel(String(req.user._id));
    return getEntitlements(String(req.user._id));
  }),
  resume: handler(async (req) => {
    await getRuntime().service.resume(String(req.user._id));
    return getEntitlements(String(req.user._id));
  }),
  discardChange: handler(async (req) => {
    await getRuntime().service.discardChange(String(req.user._id));
    return getEntitlements(String(req.user._id));
  }),
  sync: handler(async (req) => {
    await getRuntime().service.sync(String(req.user._id), req.body?.sessionId);
    return getEntitlements(String(req.user._id));
  }),
  webhook: handler((req) => getRuntime().webhook(req.body, req.headers["stripe-signature"])),
  // Gestión (auth admin): casos de dinero, ficha del entrenador e intervenciones registradas con su autor.
  adminCases: handler((req) => getRuntime().service.adminCases(req.query?.status)),
  // Buscar la ficha de un entrenador por su email (para actuar aunque no tenga casos abiertos).
  adminLookup: handler(async (req) => {
    const { BillingError } = require("../../.build/trainer-billing/types");
    const { normalizeEmail, isValidEmailFormat } = require("../util/normalize-email");
    const email = normalizeEmail(req.query?.email);
    if (!isValidEmailFormat(email)) throw new BillingError("INVALID_EMAIL", "Email no válido.", 400);
    const user = await require("../users/user-schema").findOne({ email }).select("_id email roles").lean();
    if (!user || !(user.roles || []).includes("trainer")) throw new BillingError("TRAINER_NOT_FOUND", "No hay ningún entrenador con ese email.", 404);
    return { userId: String(user._id), email: user.email };
  }),
  adminTrainer: handler((req) => getRuntime().service.adminTrainer(adminUserId(req.params.userId))),
  adminIntervene: handler((req) => getRuntime().service.intervene(adminUserId(req.params.userId), req.body || {},
    { id: String(req.user._id), email: req.user.email || null })),
};

module.exports = {
  controller, getRuntime, getEntitlements,
  // Altas y aceptaciones bajo el mismo bloqueo por entrenador que los cambios de suscripción: dos
  // invitaciones a la vez nunca ocupan la misma última plaza. No necesita Stripe (vale con Free).
  // action(admission, capacity): plazas para altas nuevas (con una bajada programada, las del
  // destino) y plazas contratadas hoy (las que puede ocupar una invitación ya reservada).
  async withClientAdmission(userId, action) {
    const current = getRuntime();
    const { admissionSeats } = require("../../.build/trainer-billing/runtime");
    return current.repository.withLock(String(userId), async (account) => {
      const user = await require("../users/user-schema").findById(userId).select("professionalPremium").lean();
      const { seats } = require("../billing/feature-access").trainerPlan(user);
      return action(admissionSeats(seats, account), seats);
    });
  },
  start: () => {
    // Sin STRIPE_KEY la facturación está apagada y no hace falta cargar nada (ni siquiera .build).
    if (!process.env.STRIPE_KEY) {
      console.warn("[TrainerBilling] Facturación apagada: falta STRIPE_KEY. Los entrenadores quedan en Free y no se ofrece contratar.");
      return;
    }
    const current = getRuntime();
    // Una configuración incompleta también la apaga: se dice al arrancar, con códigos y sin valores.
    const notice = require("../../.build/trainer-billing/config").readinessNotice(current.config);
    if (notice) console.warn(notice);
    current.startReconciliation();
  },
  async prepareDeletion(id) {
    try { await getRuntime().service.prepareDeletion(String(id)); }
    catch (error) {
      const { BillingError } = require("../../.build/trainer-billing/types");
      if (error instanceof BillingError) throw error;
      throw new BillingError("BILLING_UNAVAILABLE", "No se ha podido detener la facturación. La cuenta se conserva para poder reintentarlo.", 503);
    }
  },
  assertDeletionAllowed: (ids) => getRuntime().repository.assertDeletionAllowed(ids.map(String)),
};
