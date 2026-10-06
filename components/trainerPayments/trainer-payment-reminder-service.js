const { load: core } = require("./core");
const dao = require("./trainer-payment-dao");
const mapper = require("./trainer-payment-mapper");
const service = require("./trainer-payment-service");
const notificationDao = require("../notifications/notification-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

// Cuotas y avisos de cobro BAJO DEMANDA, sin cron (mismo criterio que las
// alertas del coach, coach-alert-service.js#ensureEvaluatedToday). La primera
// lectura que los necesita (avisos y su contador, Coach del cliente, Cobros)
// pone al día a ESE usuario:
//   1. Cuotas: materializa hasta el horizonte, anula/reajusta previsiones y
//      cierra las de parejas sin ningún scope activo.
//   2. Avisos: hitos alcanzados de sus cobros abiertos (política en reminders.ts).
// Después no vuelve a la BD hasta que algo puede cambiar (`nextAt`): la próxima
// medianoche en la zona del entrenador (el horizonte avanza un día) o el
// próximo hito de un cobro abierto, lo que llegue antes. Los avisos son solo
// in-app: crearlos al abrir la app es verlos igual de pronto. Una escritura de
// cobros invalida a la pareja (trainer-payment-controller.js#write).
//
// Repetible y segura con peticiones o procesos simultáneos: cada vencimiento
// tiene clave única, cada aviso un dedupeKey único y cada hito se registra con
// un $push condicionado. La memoria se puede perder (reinicio): solo cuesta
// repetir una pasada. Con varios procesos, un cobro escrito en otro se procesa
// como tarde en la siguiente medianoche.

const RECENTLY_ENDED_MS = 30 * 86_400_000;

const pairKey = (trainerId, clientId) => `${trainerId}:${clientId}`;

function newStats() {
  return { materialized: 0, voided: 0, repriced: 0, endedPlans: 0, remindersSent: 0, remindersSkipped: 0, errors: 0 };
}

async function settingsByTrainer(trainerIds) {
  const defaults = core().DEFAULT_REMINDER_SETTINGS;
  const docs = await dao.listSettings(trainerIds);
  const map = new Map(docs.map((doc) => [String(doc.trainerId), { timeZone: doc.timeZone, time: doc.time, offsets: doc.offsets || [] }]));
  return (trainerId) => map.get(String(trainerId)) || { ...defaults, offsets: [...defaults.offsets] };
}

// Los días de aviso del perfil, si los sobrescribe; si no, los del entrenador.
function reminderSettingsFor(settings, profile) {
  return { ...settings, offsets: profile?.reminderOffsets ?? settings.offsets };
}

function nextMidnight(now, timeZone) {
  const C = core();
  return C.instantForZonedTime(C.addDays(C.civilDayInZone(now, timeZone), 1), "00:00", timeZone);
}

function earliest(current, candidate) {
  return candidate && (!current || candidate < current) ? candidate : current;
}

// --- 1. Cuotas ------------------------------------------------------------------

// Los recurrentes abiertos llegan leídos de una vez (`openRecurring`), no con
// una consulta por cuota.
async function syncPlans(profiles, { settingsFor, isActive, openRecurring, now, stats }) {
  const byPair = new Map();
  for (const charge of openRecurring) {
    const key = pairKey(charge.trainerId, charge.clientId);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(charge);
  }
  for (const profile of profiles) {
    const plan = profile.plan;
    // Terminada hace tiempo: nada que generar ni anular. Si terminó hace poco
    // se repasa (red de seguridad: una previsión creada mientras se finalizaba).
    if (!plan || (plan.status === "ended" && !(plan.endedAt && now - plan.endedAt < RECENTLY_ENDED_MS))) continue;
    try {
      if (plan.status !== "ended" && !isActive(profile)) {
        const result = await service.onRelationChanged(profile.trainerId, profile.clientId, { now });
        if (result.ended) stats.endedPlans += 1;
        continue;
      }
      const ctx = service.makeContext(settingsFor(profile.trainerId), null, now);
      const result = await service.reconcileProfile(profile, ctx, byPair.get(pairKey(profile.trainerId, profile.clientId)) || []);
      stats.materialized += result.inserted;
      stats.voided += result.voided;
      stats.repriced += result.repriced;
    } catch (error) {
      stats.errors += 1;
      console.error("[TrainerPayments] Error en la cuota", profile.id, error.message);
    }
  }
}

// --- 2. Avisos ------------------------------------------------------------------

function logEntry(recipient, dueRevision, offset, state, now) {
  return { key: core().reminderLogKey(recipient, dueRevision, offset), recipient, dueRevision, offset, state, at: now };
}

async function clientStillEnabled(charge) {
  const [profile, relation] = await Promise.all([
    dao.findProfile(charge.trainerId, charge.clientId),
    trainerClientDao.isActivePair(charge.trainerId, charge.clientId),
  ]);
  return Boolean(profile?.clientReminders?.enabled && relation);
}

async function handleRecipient(charge, recipient, settings, now, windowStart, stats) {
  const C = core();
  const decision = C.decideReminders(charge, recipient, settings, now, windowStart);
  const chargeOid = mapper.toOid(charge.id);
  for (const milestone of decision.skip) {
    if (await dao.pushReminderLog(chargeOid, logEntry(recipient, charge.dueRevision, milestone.offset, "skipped", now))) {
      stats.remindersSkipped += 1;
    }
  }
  if (!decision.emit) return;

  // Revalidación justo antes de guardar: saldo, vencimiento vigente y, para
  // el cliente, preferencia y relación activa.
  const freshDoc = await dao.findChargeById(chargeOid);
  if (!freshDoc) return;
  const current = service.normalize(freshDoc);
  if (current.status !== "open" || C.balanceOf(current) <= 0 || current.dueRevision !== charge.dueRevision) return;
  if (recipient === "client" && !(await clientStillEnabled(current))) return;

  const offset = decision.emit.offset;
  const created = await notificationDao.createIdempotent({
    clientId: current.clientId,
    trainerId: current.trainerId,
    recipient,
    type: "payment_reminder",
    payload: {
      chargeId: current.id,
      dueDay: current.dueDay,
      dueRevision: current.dueRevision,
      offset,
      milestone: C.milestoneKind(offset),
      balanceCents: C.balanceOf(current),
      currency: current.currency,
      concept: current.concept,
    },
    dedupeKey: C.reminderDedupeKey(current.id, recipient, current.dueRevision, offset),
    createdAt: now,
  });
  await dao.pushReminderLog(chargeOid, logEntry(recipient, current.dueRevision, offset, "sent", now));
  if (!created) return; // ya lo había creado otra petición u otro proceso
  stats.remindersSent += 1;

  // Carrera con un pago, una cancelación o una baja simultáneos.
  const afterDoc = await dao.findChargeById(chargeOid);
  const after = afterDoc ? service.normalize(afterDoc) : null;
  if (after && after.status !== "open") {
    await notificationDao.resolvePaymentNotifications(after.trainerId, after.id, after.status, { now });
  }
  if (recipient === "client" && after && !(await clientStillEnabled(after))) {
    await notificationDao.deleteById(created._id);
    stats.remindersSent -= 1;
  }
}

// Avisos de `recipient` para los cobros candidatos. Devuelve el próximo hito
// futuro entre ellos (cuándo volver a mirar).
async function processReminders(docs, recipient, { settingsFor, profileFor, now, stats }) {
  const C = core();
  let nextAt = null;
  for (const doc of docs) {
    const charge = service.normalize(doc);
    const profile = profileFor(charge);
    const settings = reminderSettingsFor(settingsFor(charge.trainerId), profile);
    nextAt = earliest(nextAt, C.nextMilestone(charge.dueDay, settings, now)?.instant);
    const enabledAt = recipient === "client" ? profile.clientReminders.enabledAt : null;
    try {
      await handleRecipient(charge, recipient, settings, now, C.windowStartFor(charge, recipient, enabledAt), stats);
    } catch (error) {
      stats.errors += 1;
      console.error("[TrainerPayments] Error en avisos del cobro", charge.id, error.message);
    }
  }
  return nextAt;
}

// --- Pasadas por usuario ------------------------------------------------------------

// Entrenador: sus cuotas y SUS avisos, de toda deuda válida (puntual, anterior
// a una pausa, a un fin de cuota o de un antiguo cliente).
async function refreshTrainer(trainerId, now = new Date()) {
  const C = core();
  const stats = newStats();
  const [settingsFor, profileDocs, activeClients] = await Promise.all([
    settingsByTrainer([trainerId]),
    dao.listProfiles({ trainerId }),
    trainerClientDao.findActiveClientIds(trainerId),
  ]);
  const settings = settingsFor(trainerId);
  const today = C.civilDayInZone(now, settings.timeZone);
  const profiles = profileDocs.map((doc) => mapper.toProfile(doc));
  if (profiles.some((profile) => profile.plan)) {
    const openRecurring = (await dao.listOpenRecurring({ trainerId }, today)).map(service.normalize);
    await syncPlans(profiles, { settingsFor, isActive: (profile) => activeClients.has(profile.clientId), openRecurring, now, stats });
  }
  const profileByClient = new Map(profiles.map((profile) => [profile.clientId, profile]));
  const window = C.reminderDueWindow(today);
  const docs = await dao.listOpenDueBetween({ trainerId }, window.from, window.to);
  const nextReminder = await processReminders(docs, "trainer", {
    settingsFor,
    profileFor: (charge) => profileByClient.get(charge.clientId),
    now,
    stats,
  });
  return { stats, nextAt: earliest(nextMidnight(now, settings.timeZone), nextReminder) };
}

// Cliente: las cuotas de sus profesionales (su Coach las lista) y los avisos
// que su entrenador le activó, solo con relación activa.
async function refreshClient(clientId, now = new Date()) {
  const C = core();
  const stats = newStats();
  const [profileDocs, activeTrainers] = await Promise.all([
    dao.listProfiles({ clientId }),
    trainerClientDao.findActiveTrainerIds(clientId),
  ]);
  const profiles = profileDocs.map((doc) => mapper.toProfile(doc));
  const settingsFor = await settingsByTrainer([...new Set(profiles.map((profile) => profile.trainerId))]);
  // Cada entrenador tiene su zona: la consulta va en UTC con margen y la
  // decisión fina, con la zona de cada uno.
  const utcToday = C.civilDayInZone(now, "UTC");
  if (profiles.some((profile) => profile.plan)) {
    const openRecurring = (await dao.listOpenRecurring({ clientId }, C.addDays(utcToday, -1))).map(service.normalize);
    await syncPlans(profiles, { settingsFor, isActive: (profile) => activeTrainers.has(profile.trainerId), openRecurring, now, stats });
  }
  let nextAt = nextMidnight(now, C.DEFAULT_REMINDER_SETTINGS.timeZone);
  for (const profile of profiles) nextAt = earliest(nextAt, nextMidnight(now, settingsFor(profile.trainerId).timeZone));
  const enabled = new Map(
    profiles
      .filter((profile) => profile.clientReminders.enabled && activeTrainers.has(profile.trainerId))
      .map((profile) => [profile.trainerId, profile])
  );
  if (enabled.size) {
    const docs = await dao.listOpenDueBetween(
      { clientId, trainerId: { $in: [...enabled.keys()] } },
      C.addDays(utcToday, -C.OFFSET_MAX - 2),
      C.addDays(utcToday, -C.OFFSET_MIN + 2)
    );
    const nextReminder = await processReminders(docs, "client", {
      settingsFor,
      profileFor: (charge) => enabled.get(charge.trainerId),
      now,
      stats,
    });
    nextAt = earliest(nextAt, nextReminder);
  }
  return { stats, nextAt };
}

// --- Memoria por usuario -------------------------------------------------------------

const freshness = new Map(); // "trainer:<id>" | "client:<id>" -> { nextAt, pending, promise }
let warnedUnavailable = false;

// Peticiones simultáneas del mismo usuario (lista y contador a la vez) se unen
// a la pasada en curso en vez de lanzar otra.
function ensure(key, refresh, now) {
  const current = freshness.get(key);
  if (current && (current.pending || now < current.nextAt)) return current.promise;
  const entry = { nextAt: null, pending: true, promise: null };
  entry.promise = refresh(now).then(
    (result) => {
      entry.pending = false;
      entry.nextAt = result.nextAt;
      return result;
    },
    (error) => {
      // Sin marca: la siguiente lectura lo reintenta.
      if (freshness.get(key) === entry) freshness.delete(key);
      throw error;
    }
  );
  freshness.set(key, entry);
  return entry.promise;
}

// Nunca lanza: si falla se registra y se sirve lo que ya había. Un fallo de
// cobros no deja a nadie sin avisos ni sin Coach.
async function ensureUpToDate(kind, id, refresh, now) {
  if (!id) return;
  try {
    core();
  } catch (error) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.error(`❌ ${error.message} Sin eso no hay cuotas ni avisos de cobro.`);
    }
    return;
  }
  try {
    await ensure(`${kind}:${id}`, refresh, now);
  } catch (error) {
    console.error(`[TrainerPayments] No se pudieron poner al día los cobros (${kind} ${id}):`, error.message);
  }
}

/** Antes de leer avisos o totales del entrenador. */
function ensureTrainerUpToDate(trainerId, { now = new Date() } = {}) {
  return ensureUpToDate("trainer", trainerId && String(trainerId), (at) => refreshTrainer(trainerId, at), now);
}

/** Antes de leer avisos o cobros pendientes del cliente. */
function ensureClientUpToDate(clientId, { now = new Date() } = {}) {
  return ensureUpToDate("client", clientId && String(clientId), (at) => refreshClient(clientId, at), now);
}

// Tras escribir cobros de una pareja, su próxima lectura se pone al día ya.
// Sin cliente (zona, hora o días de aviso del entrenador) afecta a todos sus
// clientes: se olvida todo, es raro y barato.
function invalidate(trainerId, clientId = null) {
  if (!clientId) {
    freshness.clear();
    return;
  }
  freshness.delete(`trainer:${trainerId}`);
  freshness.delete(`client:${clientId}`);
}

module.exports = { ensureTrainerUpToDate, ensureClientUpToDate, invalidate, refreshTrainer, refreshClient };
