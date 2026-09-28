const mongoose = require("mongoose");
const { load: core } = require("./core");
const dao = require("./trainer-payment-dao");
const service = require("./trainer-payment-service");
const TrainerClient = require("../trainerClients/trainer-client-schema");
const User = require("../users/schema");
const { createAccentInsensitiveRegex } = require("../util/accent-insensitive-regex");

// Configuración > Cobros: vista global de la cartera y preferencias comunes.
// Los totales se agregan en Mongo sobre TODO el conjunto (nunca sobre la
// página visible) y por divisa: una divisa antigua distinta de EUR se
// informa aparte, nunca se suma ni se reinterpreta.

const STATES = ["pending", "overdue", "due_today", "upcoming", "settled", "cancelled", "all"];
const RELATIONS = ["active", "former", "all"];
const MAX_LIMIT = 50;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Relación de cada cliente con este entrenador: activa si queda algún scope
// activo; antigua si solo quedan relaciones revocadas.
async function relationMap(trainerId) {
  const relations = await TrainerClient.find({ trainerId, clientId: { $exists: true } }).select("clientId status").lean();
  const map = new Map();
  for (const relation of relations) {
    const key = String(relation.clientId);
    if (relation.status === "active") map.set(key, "active");
    else if (relation.status === "revoked" && map.get(key) !== "active") map.set(key, "former");
  }
  return map;
}

function listMatch(state, today, from, to) {
  const match = {};
  if (state === "pending") match._status = "open";
  if (state === "overdue") Object.assign(match, { _status: "open", _dueDay: { $lt: today } });
  if (state === "due_today") Object.assign(match, { _status: "open", _dueDay: today });
  if (state === "upcoming") Object.assign(match, { _status: "open", _dueDay: { $gt: today } });
  if (state === "settled") match._status = "settled";
  if (state === "cancelled") match._status = "cancelled";
  if (from || to) {
    match._dueDay = { ...(typeof match._dueDay === "object" ? match._dueDay : match._dueDay ? { $eq: match._dueDay } : {}) };
    if (from) match._dueDay.$gte = from;
    if (to) match._dueDay.$lte = to;
  }
  return match;
}

function byCurrency(rows, fields) {
  const result = {};
  for (const row of rows) {
    result[row._id] = {};
    for (const field of fields) result[row._id][field] = row[field] || 0;
  }
  return result;
}

async function getOverview(trainerId, query = {}) {
  const C = core();
  const settings = await service.loadSettings(trainerId);
  const ctx = service.makeContext(settings, trainerId);
  const state = STATES.includes(query.state) ? query.state : "pending";
  const relation = RELATIONS.includes(query.relation) ? query.relation : "all";
  const from = query.from && C.isCivilDay(query.from) ? query.from : null;
  const to = query.to && C.isCivilDay(query.to) ? query.to : null;
  const page = Math.max(0, Number.parseInt(query.page, 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || 20));
  const search = typeof query.search === "string" ? query.search.trim().slice(0, 80) : "";

  const relations = await relationMap(trainerId);
  let clientIds = [...relations.entries()].filter(([, kind]) => relation === "all" || kind === relation).map(([id]) => id);
  if (search && clientIds.length) {
    const pattern = new RegExp(createAccentInsensitiveRegex(escapeRegex(search)), "i");
    const matches = await User.find({ _id: { $in: clientIds }, $or: [{ name: pattern }, { lastname: pattern }, { email: pattern }] })
      .select("_id")
      .lean();
    clientIds = matches.map((user) => String(user._id));
  }

  const scope = {
    relation,
    search: search || null,
    clients: clientIds.length,
    currency: "EUR",
    today: ctx.today,
    month: C.monthOf(ctx.today),
    timeZone: settings.timeZone,
  };
  const empty = {
    scope,
    totals: { pendingCents: 0, overdueCents: 0, overdueCount: 0, receivedThisMonthCents: 0, forecastCents: 0, otherCurrencies: [] },
    results: { count: 0, balanceCents: 0, page, limit, state, from, to },
    rows: [],
  };
  if (!clientIds.length) return empty;

  const base = {
    trainerId: new mongoose.Types.ObjectId(String(trainerId)),
    clientId: { $in: clientIds.map((id) => new mongoose.Types.ObjectId(id)) },
    status: { $ne: "void" },
  };
  const filter = listMatch(state, ctx.today, from, to);
  const [facet] = await dao.aggregate([
    { $match: base },
    ...dao.normalizeStages(ctx.today),
    {
      $facet: {
        rows: [
          { $match: filter },
          { $sort: { _group: 1, _sortKey: 1, _id: 1 } },
          { $skip: page * limit },
          { $limit: limit },
          {
            $project: {
              clientId: 1,
              origin: 1,
              concept: 1,
              historical: 1,
              anomalies: 1,
              hasNote: { $gt: [{ $strLenCP: { $ifNull: ["$note", ""] } }, 0] },
              currency: "$_currency",
              dueDay: "$_dueDay",
              amountCents: "$_amountCents",
              receivedCents: "$_received",
              cancelledCents: "$_cancelled",
              balanceCents: { $max: ["$_balance", 0] },
              status: "$_status",
              group: "$_group",
              forecast: "$_forecast",
              migrated: "$_v2",
            },
          },
        ],
        results: [
          { $match: filter },
          {
            $group: {
              _id: "$_currency",
              count: { $sum: 1 },
              balanceCents: { $sum: { $cond: [{ $eq: ["$_status", "open"] }, { $max: ["$_balance", 0] }, 0] } },
            },
          },
        ],
        portfolio: [
          {
            $group: {
              _id: "$_currency",
              pendingCents: {
                $sum: { $cond: [{ $and: [{ $eq: ["$_status", "open"] }, { $not: ["$_forecast"] }] }, { $max: ["$_balance", 0] }, 0] },
              },
              overdueCents: {
                $sum: { $cond: [{ $and: [{ $eq: ["$_status", "open"] }, { $lt: ["$_dueDay", ctx.today] }] }, { $max: ["$_balance", 0] }, 0] },
              },
              overdueCount: {
                $sum: {
                  $cond: [
                    { $and: [{ $eq: ["$_status", "open"] }, { $lt: ["$_dueDay", ctx.today] }, { $gt: ["$_balance", 0] }] },
                    1,
                    0,
                  ],
                },
              },
              forecastCents: { $sum: { $cond: ["$_forecast", "$_balance", 0] } },
            },
          },
        ],
        // Recibido por fecha REAL de recepción (no por vencimiento ni por
        // cuándo se anotó); una anulación nunca suma aquí.
        received: [
          { $project: { _currency: 1, _movements: 1 } },
          { $unwind: "$_movements" },
          { $match: { "_movements.status": "valid", "_movements.receivedDay": { $regex: `^${C.monthOf(ctx.today)}` } } },
          { $group: { _id: "$_currency", receivedCents: { $sum: "$_movements.amountCents" } } },
        ],
      },
    },
  ]);

  const portfolio = byCurrency(facet.portfolio, ["pendingCents", "overdueCents", "overdueCount", "forecastCents"]);
  const received = byCurrency(facet.received, ["receivedCents"]);
  const results = byCurrency(facet.results, ["count", "balanceCents"]);
  const count = facet.results.reduce((total, row) => total + row.count, 0);
  const others = [...new Set([...Object.keys(portfolio), ...Object.keys(received)])]
    .filter((currency) => currency !== "EUR")
    .map((currency) => ({
      currency,
      pendingCents: portfolio[currency]?.pendingCents || 0,
      receivedThisMonthCents: received[currency]?.receivedCents || 0,
    }));

  const pageClientIds = [...new Set(facet.rows.map((row) => String(row.clientId)))];
  const users = await User.find({ _id: { $in: pageClientIds } }).select("name lastname email").lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));

  return {
    scope,
    totals: {
      pendingCents: portfolio.EUR?.pendingCents || 0,
      overdueCents: portfolio.EUR?.overdueCents || 0,
      overdueCount: portfolio.EUR?.overdueCount || 0,
      forecastCents: portfolio.EUR?.forecastCents || 0,
      receivedThisMonthCents: received.EUR?.receivedCents || 0,
      otherCurrencies: others,
    },
    results: { count, balanceCents: results.EUR?.balanceCents || 0, page, limit, state, from, to },
    rows: facet.rows.map((row) => {
      const user = userById.get(String(row.clientId));
      return {
        id: String(row._id),
        clientId: String(row.clientId),
        clientName: user ? `${user.name || ""} ${user.lastname || ""}`.trim() || user.email : "Cliente eliminado",
        clientRelation: relations.get(String(row.clientId)) || "former",
        origin: row.origin || "legacy",
        concept: row.concept || null,
        historical: Boolean(row.historical),
        hasNote: row.hasNote,
        currency: row.currency,
        dueDay: row.dueDay,
        amountCents: row.amountCents,
        receivedCents: row.receivedCents,
        cancelledCents: row.cancelledCents,
        balanceCents: row.balanceCents,
        status: row.status,
        temporal: ["overdue", "due_today", "upcoming", "closed"][row.group],
        forecast: row.forecast,
        anomalies: row.anomalies || [],
        migrated: row.migrated,
      };
    }),
  };
}

// GET /trainer/payments/summary — contrato del dashboard general, con el
// saldo real tras parciales. La serie es por VENCIMIENTO (importe previsto
// menos anulado), no dinero recibido; `receivedSeries` es por recepción.
async function getLegacySummary(trainerId) {
  const C = core();
  const settings = await service.loadSettings(trainerId);
  const ctx = service.makeContext(settings, trainerId);
  const months = [];
  const [year, month] = ctx.today.split("-").map(Number);
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    months.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const [facet] = await dao.aggregate([
    { $match: { trainerId: new mongoose.Types.ObjectId(String(trainerId)), status: { $ne: "void" } } },
    ...dao.normalizeStages(ctx.today),
    { $match: { _currency: "EUR" } },
    {
      $facet: {
        pending: [
          { $match: { _status: "open", _forecast: false, _balance: { $gt: 0 } } },
          {
            $group: {
              _id: null,
              pendingCents: { $sum: "$_balance" },
              pendingCount: { $sum: 1 },
              overdueCount: { $sum: { $cond: [{ $lt: ["$_dueDay", ctx.today] }, 1, 0] } },
              overdueCents: { $sum: { $cond: [{ $lt: ["$_dueDay", ctx.today] }, "$_balance", 0] } },
            },
          },
        ],
        due: [
          { $match: { _dueDay: { $gte: `${months[0]}-01` } } },
          { $group: { _id: { $substrCP: ["$_dueDay", 0, 7] }, cents: { $sum: { $subtract: ["$_amountCents", "$_cancelled"] } } } },
        ],
        received: [
          { $unwind: "$_movements" },
          { $match: { "_movements.status": "valid", "_movements.receivedDay": { $gte: `${months[0]}-01` } } },
          { $group: { _id: { $substrCP: ["$_movements.receivedDay", 0, 7] }, cents: { $sum: "$_movements.amountCents" } } },
        ],
      },
    },
  ]);
  const due = new Map(facet.due.map((row) => [row._id, row.cents]));
  const received = new Map(facet.received.map((row) => [row._id, row.cents]));
  const monthlySeries = months.map((key) => ({ month: key, totalAmount: C.centsToAmount(due.get(key) || 0) }));
  const receivedSeries = months.map((key) => ({ month: key, totalAmount: C.centsToAmount(received.get(key) || 0) }));
  const current = monthlySeries[5].totalAmount;
  const previous = monthlySeries[4].totalAmount;
  let percentChangeVsLastMonth = null;
  if (previous > 0) percentChangeVsLastMonth = Math.round(((current - previous) / previous) * 100);
  else if (current > 0) percentChangeVsLastMonth = 100;
  const pending = facet.pending[0] || {};
  return {
    pendingAmount: C.centsToAmount(pending.pendingCents || 0),
    pendingCount: pending.pendingCount || 0,
    overdueCount: pending.overdueCount || 0,
    overdueAmount: C.centsToAmount(pending.overdueCents || 0),
    currency: "EUR",
    seriesBasis: "due_date",
    monthlySeries,
    receivedSeries,
    percentChangeVsLastMonth,
  };
}

// --- Preferencias comunes ------------------------------------------------------------------

function settingsView(settings) {
  const C = core();
  return {
    timeZone: settings.timeZone,
    time: settings.time,
    offsets: settings.offsets,
    persisted: settings.persisted,
    revision: settings.revision,
    defaults: C.DEFAULT_REMINDER_SETTINGS,
    limits: { offsetMin: C.OFFSET_MIN, offsetMax: C.OFFSET_MAX, maxCount: C.OFFSETS_MAX_COUNT },
  };
}

async function getSettings(trainerId) {
  return settingsView(await service.loadSettings(trainerId));
}

async function saveSettings(trainerId, body) {
  const C = core();
  const next = C.parseReminderSettings(body || {});
  await dao.saveSettings(trainerId, next, new Date());
  return settingsView(await service.loadSettings(trainerId));
}

// Efecto de un cambio de zona/hora antes de guardar: las fechas civiles de
// vencimiento no se mueven; solo cambian los instantes de los avisos futuros.
async function previewSettings(trainerId, body) {
  const C = core();
  const next = C.parseReminderSettings(body || {});
  const current = await service.loadSettings(trainerId);
  const now = new Date();
  const currentToday = C.civilDayInZone(now, current.timeZone);
  const nextToday = C.civilDayInZone(now, next.timeZone);
  const window = C.reminderDueWindow(currentToday);
  const docs = await dao.listOpenDueBetween({ trainerId }, currentToday, window.to);
  const samples = docs
    .map((doc) => service.normalize(doc))
    .filter((charge) => charge.dueDay >= currentToday)
    .sort((a, b) => (a.dueDay < b.dueDay ? -1 : 1))
    .slice(0, 5)
    .map((charge) => ({
      chargeId: charge.id,
      dueDay: charge.dueDay,
      currentNext: C.nextMilestone(charge.dueDay, current, now),
      nextNext: C.nextMilestone(charge.dueDay, next, now),
    }));
  return {
    todayChanges: currentToday !== nextToday ? { from: currentToday, to: nextToday } : null,
    samples,
    note: "Las fechas de vencimiento y de recepción no cambian; solo se recalculan los avisos que aún no se han enviado.",
  };
}

module.exports = { getOverview, getLegacySummary, getSettings, saveSettings, previewSettings, relationMap };
