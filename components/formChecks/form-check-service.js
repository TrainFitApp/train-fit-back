// Revisiones de técnica (docs/plan-medidas-multimedia.md, pieza 2).
//
// Retención: 90 días salvo «Conservar». Sin crons: lo caducado se borra y los
// avisos de «se borra en 7 días» se crean bajo demanda, la primera vez que
// alguien abre la bandeja, el dashboard o el ejercicio (mismo patrón que
// coach-alert-service.js#ensureEvaluatedToday).

const mongoose = require("mongoose");
const formCheckDao = require("./form-check-dao");
const mediaService = require("../media/media-service");
const { FORM_CHECKS_PER_WEEK, EXPIRY_WARNING_DAYS, PURPOSES } = require("../media/media-catalog");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const notificationDao = require("../notifications/notification-dao");
const { todayIsoDate, timeZoneOf } = require("../util/date-util");

const DAY_MS = 86400000;
const RETENTION_DAYS = PURPOSES.form_check.retentionDays;

// Campos de la serie que se copian. Prescrito (expected*) y ejecutado van
// por separado y nunca se mezclan (docs/domain.md).
const SNAPSHOT_NUMBERS = [
  "reps",
  "weight",
  "expectedWeight",
  "restSeconds",
  "expectedDistance",
  "distance",
];
const SNAPSHOT_ARRAYS = ["rir", "expectedRir", "expectedReps"];
const SNAPSHOT_STRINGS = ["expectedTime", "time"];

function fail(status, code, message) {
  return { error: { status, code, message } };
}

const assetInUse = () => fail(409, "FORM_CHECK_ASSET_IN_USE", "Ese vídeo ya está en otra revisión");

function sanitizeSnapshot(input) {
  if (!input || typeof input !== "object") return null;
  const out = {};
  if (Number.isInteger(input.index) && input.index >= 0 && input.index < 100) out.index = input.index;
  for (const key of SNAPSHOT_NUMBERS) {
    const value = Number(input[key]);
    if (input[key] != null && input[key] !== "" && Number.isFinite(value)) out[key] = value;
  }
  for (const key of SNAPSHOT_ARRAYS) {
    if (Array.isArray(input[key])) {
      const values = input[key].map(Number).filter((value) => Number.isFinite(value)).slice(0, 5);
      if (values.length) out[key] = values;
    }
  }
  for (const key of SNAPSHOT_STRINGS) {
    if (typeof input[key] === "string" && input[key].trim()) out[key] = input[key].trim().slice(0, 20);
  }
  if (input.drop === true) out.drop = true;
  return Object.keys(out).length ? out : null;
}

function daysLeft(check, now = Date.now()) {
  if (check.keep || !check.expiresAt) return null;
  return Math.max(0, Math.ceil((new Date(check.expiresAt).getTime() - now) / DAY_MS));
}

function clientNameOf(client) {
  if (!client || typeof client !== "object") return "";
  return [client.name, client.lastname].filter(Boolean).join(" ") || client.email || "";
}

async function viewsOf(checks, { baseUrl, forTrainer }) {
  const assetIds = checks.map((check) => String(check.assetId));
  const videoIds = checks.flatMap((check) =>
    (check.comments || []).map((comment) => comment.techniqueVideoId).filter(Boolean).map(String)
  );
  const [assets, videos] = await Promise.all([
    mediaService.viewsByIds(assetIds, { baseUrl }),
    require("../techniqueVideos/technique-video-service").viewsByIds(videoIds, { baseUrl }),
  ]);
  return checks.map((check) => {
    const client = check.clientId && typeof check.clientId === "object" && check.clientId._id ? check.clientId : null;
    const lastTrainerComment = (check.comments || []).reduce(
      (latest, comment) => (!latest || comment.createdAt > latest ? comment.createdAt : latest),
      null
    );
    return {
      id: String(check._id),
      clientId: String(client?._id || check.clientId),
      clientName: forTrainer ? clientNameOf(client) : undefined,
      trainerId: String(check.trainerId),
      exerciseId: check.exerciseId ? String(check.exerciseId) : null,
      exerciseName: check.exerciseName || "",
      tableId: check.tableId ? String(check.tableId) : null,
      date: check.date,
      setSnapshot: check.setSnapshot || null,
      clientNote: check.clientNote || "",
      status: check.status,
      reviewedAt: check.reviewedAt,
      createdAt: check.createdAt,
      keep: Boolean(check.keep),
      expiresAt: check.expiresAt,
      daysLeft: daysLeft(check),
      expiringSoon: daysLeft(check) != null && daysLeft(check) <= EXPIRY_WARNING_DAYS,
      // El cliente tiene respuesta nueva que no ha visto.
      unseenFeedback:
        check.status === "reviewed" && (!check.clientSeenAt || (lastTrainerComment && lastTrainerComment > check.clientSeenAt)),
      video: assets.get(String(check.assetId)) || null,
      comments: (check.comments || [])
        .slice()
        .sort((a, b) => (a.atSec ?? Infinity) - (b.atSec ?? Infinity) || new Date(a.createdAt) - new Date(b.createdAt))
        .map((comment) => ({
          id: String(comment._id),
          atSec: comment.atSec,
          text: comment.text || "",
          createdAt: comment.createdAt,
          techniqueVideo: comment.techniqueVideoId ? videos.get(String(comment.techniqueVideoId)) || null : null,
        })),
    };
  });
}

// Clientes con relación de entrenamiento ACTIVA con este profesional: con
// la relación revocada, pierde el acceso a sus revisiones.
async function activeTrainingClientIds(trainerId) {
  return [...(await trainerClientDao.findActiveClientIds(trainerId, { scope: "training" }))];
}

async function purgeExpired(filter) {
  await formCheckDao.deleteExpired(filter);
}

/** Aviso único por revisión cuando le quedan 7 días o menos. */
async function ensureExpiryNotices(trainerId) {
  const until = new Date(Date.now() + EXPIRY_WARNING_DAYS * DAY_MS);
  const expiring = await formCheckDao.findExpiringUnnotified(trainerId, until);
  for (const check of expiring) {
    await notificationDao.createIdempotent({
      clientId: check.clientId,
      trainerId: check.trainerId,
      recipient: "trainer",
      type: "form_check_expiring",
      payload: { formCheckId: String(check._id), exerciseName: check.exerciseName, expiresAt: check.expiresAt },
      dedupeKey: `form_check_expiring:${check._id}`,
    });
    await formCheckDao.update(check._id, { expiryNotifiedAt: new Date() });
  }
}

module.exports = {
  sanitizeSnapshot,
  ensureExpiryNotices,

  // --- Lado cliente ---

  async create(user, body, { baseUrl } = {}) {
    const attachable = await mediaService.assertAttachable(user, body?.assetId, ["form_check"]);
    if (attachable.error) return attachable;

    const trainerIds = [...(await trainerClientDao.findActiveTrainerIds(user._id, "training"))];
    if (!trainerIds.length) return fail(403, "FORM_CHECK_NO_TRAINER", "Necesitas un entrenador activo para enviarle vídeos");
    const trainerId = body?.trainerId ? trainerIds.find((id) => id === String(body.trainerId)) : trainerIds[0];
    if (!trainerId) return fail(403, "FORM_CHECK_NO_TRAINER", "Ese entrenador no está activo");

    const recent = await formCheckDao.countSince(user._id, new Date(Date.now() - 7 * DAY_MS));
    if (recent >= FORM_CHECKS_PER_WEEK) {
      return fail(429, "FORM_CHECK_WEEKLY_LIMIT", `Puedes enviar ${FORM_CHECKS_PER_WEEK} vídeos por semana`);
    }
    // Un vídeo solo cuelga de una revisión (índice único en el schema; esta
    // comprobación da el error claro antes de llegar a él).
    if (await formCheckDao.existsForAsset(attachable.asset._id)) return assetInUse();

    // Hasta hoy en la zona del cliente; sin fecha válida, hoy.
    const today = todayIsoDate(timeZoneOf(user));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(body?.date || "") && body.date <= today ? body.date : today;
    const now = new Date();
    const check = await formCheckDao.create({
      clientId: user._id,
      trainerId,
      assetId: attachable.asset._id,
      exerciseId: mongoose.isValidObjectId(body?.exerciseId) ? body.exerciseId : null,
      exerciseName: String(body?.exerciseName || "").trim().slice(0, 200),
      tableId: mongoose.isValidObjectId(body?.tableId) ? body.tableId : null,
      date,
      setSnapshot: sanitizeSnapshot(body?.setSnapshot),
      clientNote: String(body?.clientNote || "").trim().slice(0, 500),
      createdAt: now,
      expiresAt: new Date(now.getTime() + RETENTION_DAYS * DAY_MS),
    }).catch((error) => {
      // Dos envíos a la vez con el mismo vídeo: gana el primero.
      if (error?.code === 11000) return null;
      throw error;
    });
    if (!check) return assetInUse();

    await notificationDao.createForTrainer(trainerId, user._id, "form_check_submitted", {
      formCheckId: String(check._id),
      exerciseName: check.exerciseName,
    });

    const [view] = await viewsOf([check], { baseUrl, forTrainer: false });
    return { formCheck: view };
  },

  async listMine(user, { exerciseId } = {}, { baseUrl } = {}) {
    await purgeExpired({ clientId: user._id });
    const checks = await formCheckDao.listForClient(user._id, { exerciseId });
    const recent = await formCheckDao.countSince(user._id, new Date(Date.now() - 7 * DAY_MS));
    return {
      formChecks: await viewsOf(checks, { baseUrl, forTrainer: false }),
      weeklyLimit: FORM_CHECKS_PER_WEEK,
      weeklyUsed: recent,
    };
  },

  async markSeenMine(user, id) {
    const check = await formCheckDao.findById(id);
    if (!check || String(check.clientId) !== String(user._id)) return fail(404, "FORM_CHECK_NOT_FOUND", "Revisión no encontrada");
    await formCheckDao.update(check._id, { clientSeenAt: new Date() });
    return { ok: true };
  },

  async deleteMine(user, id) {
    const check = await formCheckDao.findById(id);
    if (!check || String(check.clientId) !== String(user._id)) return fail(404, "FORM_CHECK_NOT_FOUND", "Revisión no encontrada");
    await formCheckDao.deleteById(check._id);
    await notificationDao.deleteByPayload("form_check_submitted", "formCheckId", check._id);
    return { ok: true };
  },

  // --- Lado profesional ---

  async listForTrainer(trainerId, { status, clientId } = {}, { baseUrl } = {}) {
    await purgeExpired({ trainerId });
    await ensureExpiryNotices(trainerId);
    let clientIds = await activeTrainingClientIds(trainerId);
    if (clientId) clientIds = clientIds.filter((id) => String(id) === String(clientId));
    const checks = await formCheckDao.listForTrainer(trainerId, { status, clientIds });
    const formChecks = await viewsOf(checks, { baseUrl, forTrainer: true });
    return {
      formChecks,
      pendingCount: formChecks.filter((check) => check.status === "pending").length,
      expiringSoonCount: formChecks.filter((check) => check.expiringSoon).length,
    };
  },

  async pendingCount(trainerId) {
    await purgeExpired({ trainerId });
    await ensureExpiryNotices(trainerId);
    const clientIds = await activeTrainingClientIds(trainerId);
    return { pendingCount: await formCheckDao.countPendingForTrainer(trainerId, clientIds) };
  },

  async loadForTrainer(trainerId, id) {
    const check = await formCheckDao.findById(id);
    if (!check || String(check.trainerId) !== String(trainerId)) return null;
    return (await trainerClientDao.isActivePair(trainerId, check.clientId, "training")) ? check : null;
  },

  async getForTrainer(trainerId, id, { baseUrl } = {}) {
    const check = await this.loadForTrainer(trainerId, id);
    if (!check) return fail(404, "FORM_CHECK_NOT_FOUND", "Revisión no encontrada");
    if (!check.trainerSeenAt) await formCheckDao.update(check._id, { trainerSeenAt: new Date() });
    const withClient = await formCheckDao.findWithClient(check._id);
    const [view] = await viewsOf([withClient], { baseUrl, forTrainer: true });
    return { formCheck: view };
  },

  async addComment(trainerId, id, body, { baseUrl } = {}) {
    const check = await this.loadForTrainer(trainerId, id);
    if (!check) return fail(404, "FORM_CHECK_NOT_FOUND", "Revisión no encontrada");
    const text = String(body?.text || "").trim().slice(0, 1000);
    const atSec = body?.atSec == null || body.atSec === "" ? null : Number(body.atSec);
    if (atSec != null && (!Number.isFinite(atSec) || atSec < 0 || atSec > 3600)) {
      return fail(400, "FORM_CHECK_INVALID_TIME", "Segundo no válido");
    }
    let techniqueVideoId = null;
    if (body?.techniqueVideoId) {
      const video = await require("../techniqueVideos/technique-video-dao").findById(body.techniqueVideoId);
      if (!video || String(video.trainerId) !== String(trainerId)) {
        return fail(404, "TECHNIQUE_VIDEO_NOT_FOUND", "Vídeo no encontrado");
      }
      techniqueVideoId = video._id;
    }
    if (!text && !techniqueVideoId) return fail(400, "FORM_CHECK_EMPTY_COMMENT", "Escribe un comentario");
    await formCheckDao.pushComment(check._id, {
      atSec: atSec == null ? null : Math.round(atSec * 10) / 10,
      text,
      techniqueVideoId,
      authorId: trainerId,
      createdAt: new Date(),
    });
    return this.getForTrainer(trainerId, id, { baseUrl });
  },

  async removeComment(trainerId, id, commentId, { baseUrl } = {}) {
    const check = await this.loadForTrainer(trainerId, id);
    if (!check) return fail(404, "FORM_CHECK_NOT_FOUND", "Revisión no encontrada");
    if (!mongoose.isValidObjectId(commentId)) return fail(404, "FORM_CHECK_NOT_FOUND", "Comentario no encontrado");
    await formCheckDao.pullComment(check._id, commentId);
    return this.getForTrainer(trainerId, id, { baseUrl });
  },

  /** Marca como revisada y avisa al cliente. Volver a pulsar reenvía el aviso. */
  async review(trainerId, id, { baseUrl } = {}) {
    const check = await this.loadForTrainer(trainerId, id);
    if (!check) return fail(404, "FORM_CHECK_NOT_FOUND", "Revisión no encontrada");
    if (!(check.comments || []).length) return fail(400, "FORM_CHECK_NO_COMMENTS", "Añade al menos un comentario antes de enviarla");
    await formCheckDao.update(check._id, { status: "reviewed", reviewedAt: new Date(), clientSeenAt: null });
    await notificationDao.create(check.clientId, trainerId, "form_check_reviewed", {
      formCheckId: String(check._id),
      exerciseName: check.exerciseName,
      exerciseId: check.exerciseId ? String(check.exerciseId) : null,
    });
    return this.getForTrainer(trainerId, id, { baseUrl });
  },

  async setKeep(trainerId, id, keep, { baseUrl } = {}) {
    const check = await this.loadForTrainer(trainerId, id);
    if (!check) return fail(404, "FORM_CHECK_NOT_FOUND", "Revisión no encontrada");
    let set;
    if (keep) {
      set = { keep: true, expiresAt: null };
    } else {
      // Al dejar de conservarla nunca se borra de golpe: como poco, 7 días
      // de margen con su aviso.
      const byCreation = new Date(check.createdAt).getTime() + RETENTION_DAYS * DAY_MS;
      const minimum = Date.now() + EXPIRY_WARNING_DAYS * DAY_MS;
      set = { keep: false, expiresAt: new Date(Math.max(byCreation, minimum)), expiryNotifiedAt: null };
    }
    await formCheckDao.update(check._id, set);
    return this.getForTrainer(trainerId, id, { baseUrl });
  },
};
