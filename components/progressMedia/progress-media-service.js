// Fotos y vídeos de progreso del cliente (docs/plan-medidas-multimedia.md).

const progressMediaDao = require("./progress-media-dao");
const mediaService = require("../media/media-service");
const { POSES } = require("../media/media-catalog");
const { relationStartOf, trainerCanSeeProgressDay } = require("../media/media-access");
const trainerClientDao = require("../trainerClients/trainer-client-dao");
const anthropometryDao = require("../anthropometry/anthropometry-dao");
const { ownView } = require("../anthropometry/anthropometry-origin");
const { isoDate, todayIsoDate, addDaysToIsoDate } = require("../util/date-util");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(status, code, message) {
  return { error: { status, code, message } };
}

function validDate(date) {
  // Mañana también vale: el móvil del cliente puede ir por delante en zona horaria.
  return DATE_RE.test(String(date || "")) && date <= addDaysToIsoDate(todayIsoDate(), 1);
}

async function anthropometryByDate(userId, dates, { own }) {
  if (!dates.length) return new Map();
  const sorted = [...dates].sort();
  const docs = await anthropometryDao.getAnthropometriesByUserIdBetweenDates(userId, sorted[0], sorted[sorted.length - 1]);
  const map = new Map();
  for (const doc of docs || []) {
    const view = own ? ownView(doc) : doc;
    if (view) map.set(doc.date, view);
  }
  return map;
}

async function viewsOfDays(days, { baseUrl, userId, ownAnthropometry, trainerId }) {
  const assetIds = days.flatMap((day) => [
    ...(day.photos || []).map((photo) => String(photo.assetId)),
    ...(day.videos || []).map((video) => String(video.assetId)),
  ]);
  const [assets, anthropometries] = await Promise.all([
    mediaService.viewsByIds(assetIds, { baseUrl }),
    anthropometryByDate(userId, days.map((day) => day.date), { own: ownAnthropometry }),
  ]);
  return days.map((day) => ({
    id: String(day._id),
    date: day.date,
    note: day.note || "",
    hiddenFromTrainers: Boolean(day.hiddenFromTrainers),
    // El cliente ve si el día ya se mandó en un check-in (entonces lo ve el
    // entrenador que lo pidió aunque esté oculto).
    answersCheckin: (day.checkins || []).length > 0,
    answersCheckinFor: trainerId
      ? (day.checkins || []).some((checkin) => String(checkin.trainerId) === String(trainerId))
      : undefined,
    photos: POSES.map((pose) => {
      const photo = (day.photos || []).find((item) => item.pose === pose);
      return photo ? { pose, asset: assets.get(String(photo.assetId)) || null } : null;
    }).filter((photo) => photo && photo.asset),
    videos: (day.videos || [])
      .map((video) => ({ note: video.note || "", createdAt: video.createdAt, asset: assets.get(String(video.assetId)) || null }))
      .filter((video) => video.asset),
    anthropometry: anthropometries.get(day.date) || null,
  }));
}

module.exports = {
  validDate,

  async listMine(user, { from, to } = {}, { baseUrl } = {}) {
    const days = await progressMediaDao.listRange(user._id, { from, to });
    return { days: await viewsOfDays(days, { baseUrl, userId: user._id, ownAnthropometry: true }) };
  },

  async dayView(user, date, { baseUrl } = {}) {
    const day = await progressMediaDao.findDay(user._id, date);
    if (!day) return null;
    const [view] = await viewsOfDays([day], { baseUrl, userId: user._id, ownAnthropometry: true });
    return view;
  },

  async setPhoto(user, date, pose, assetId, { baseUrl } = {}) {
    if (!validDate(date)) return fail(400, "PROGRESS_INVALID_DATE", "Fecha no válida");
    if (!POSES.includes(pose)) return fail(400, "PROGRESS_INVALID_POSE", "Pose no válida");
    const attachable = await mediaService.assertAttachable(user, assetId, ["progress_photo"]);
    if (attachable.error) return attachable;
    const { replacedAssetId } = await progressMediaDao.setPhoto(user._id, date, pose, attachable.asset._id);
    if (replacedAssetId && String(replacedAssetId) !== String(assetId)) {
      await mediaService.deleteAssets([replacedAssetId]);
    }
    return { day: await this.dayView(user, date, { baseUrl }) };
  },

  async removePhoto(user, date, pose, { baseUrl } = {}) {
    if (!validDate(date)) return fail(400, "PROGRESS_INVALID_DATE", "Fecha no válida");
    const { removedAssetId } = await progressMediaDao.removePhoto(user._id, date, pose);
    if (removedAssetId) await mediaService.deleteAssets([removedAssetId]);
    await progressMediaDao.deleteIfEmpty(user._id, date);
    return { day: await this.dayView(user, date, { baseUrl }) };
  },

  async addVideo(user, date, assetId, note, { baseUrl } = {}) {
    if (!validDate(date)) return fail(400, "PROGRESS_INVALID_DATE", "Fecha no válida");
    const attachable = await mediaService.assertAttachable(user, assetId, ["progress_video"]);
    if (attachable.error) return attachable;
    const existing = await progressMediaDao.findDay(user._id, date);
    if (existing?.videos?.some((video) => String(video.assetId) === String(assetId))) {
      return { day: await this.dayView(user, date, { baseUrl }) };
    }
    await progressMediaDao.addVideo(user._id, date, attachable.asset._id, String(note || "").slice(0, 500));
    return { day: await this.dayView(user, date, { baseUrl }) };
  },

  async removeVideo(user, date, assetId, { baseUrl } = {}) {
    if (!validDate(date)) return fail(400, "PROGRESS_INVALID_DATE", "Fecha no válida");
    const existing = await progressMediaDao.findDay(user._id, date);
    const video = existing?.videos?.find((item) => String(item.assetId) === String(assetId));
    if (!video) return fail(404, "PROGRESS_NOT_FOUND", "Vídeo no encontrado");
    await progressMediaDao.removeVideo(user._id, date, video.assetId);
    await mediaService.deleteAssets([video.assetId]);
    await progressMediaDao.deleteIfEmpty(user._id, date);
    return { day: await this.dayView(user, date, { baseUrl }) };
  },

  async updateDay(user, date, body, { baseUrl } = {}) {
    if (!validDate(date)) return fail(400, "PROGRESS_INVALID_DATE", "Fecha no válida");
    const set = {};
    if (typeof body?.note === "string") set.note = body.note.trim().slice(0, 500);
    if (typeof body?.hiddenFromTrainers === "boolean") set.hiddenFromTrainers = body.hiddenFromTrainers;
    if (!Object.keys(set).length) return fail(400, "PROGRESS_NOTHING_TO_UPDATE", "Nada que cambiar");
    await progressMediaDao.updateMeta(user._id, date, set);
    return { day: await this.dayView(user, date, { baseUrl }) };
  },

  /**
   * Profesionales activos del cliente y si ven su historial anterior. La app
   * enseña la pregunta única «¿Quieres que X vea tus N sesiones anteriores?»
   * a los que aún no se ha hecho y tienen algo anterior que ver.
   */
  async trainersForHistory(user) {
    const relations = await trainerClientDao.findActiveByClientWithTrainer(user._id);
    const byTrainer = new Map();
    for (const relation of relations) {
      const key = String(relation.trainerId?._id || relation.trainerId);
      if (!byTrainer.has(key)) byTrainer.set(key, []);
      byTrainer.get(key).push(relation);
    }
    const trainers = [];
    for (const [trainerId, list] of byTrainer) {
      const start = relationStartOf(list);
      const trainer = list[0].trainerId || {};
      const previousDays = start ? await progressMediaDao.countBefore(user._id, isoDate(start)) : 0;
      trainers.push({
        trainerId,
        name: [trainer.name, trainer.lastname].filter(Boolean).join(" ") || trainer.email || "",
        scopes: [...new Set(list.map((relation) => relation.scope))],
        since: start ? isoDate(start) : null,
        historyShared: list.some((relation) => relation.mediaHistorySharedAt),
        historyAsked: list.some((relation) => relation.mediaHistoryAskedAt),
        previousDays,
      });
    }
    return { trainers };
  },

  async setHistoryShared(user, trainerId, shared) {
    const updated = await trainerClientDao.setMediaHistory(trainerId, user._id, Boolean(shared));
    if (!updated) return fail(404, "PROGRESS_NO_RELATION", "No tienes una relación activa con ese profesional");
    return this.trainersForHistory(user);
  },

  // --- Lado profesional ---

  async listForTrainer(trainerId, clientId, { from, to } = {}, { baseUrl } = {}) {
    const relations = await trainerClientDao.findActiveRelationsOfPair(trainerId, clientId);
    const relationStart = relationStartOf(relations);
    const historyShared = relations.some((relation) => relation.mediaHistorySharedAt);
    const days = await progressMediaDao.listRange(clientId, { from, to });
    const visible = days.filter((day) =>
      trainerCanSeeProgressDay(day, { trainerId, relationStart, historyShared })
    );
    return {
      since: relationStart ? isoDate(relationStart) : null,
      historyShared,
      days: await viewsOfDays(visible, { baseUrl, userId: clientId, ownAnthropometry: false, trainerId }),
    };
  },

  /**
   * Para check-ins: el día que el cliente manda como respuesta de fotos.
   * Tiene que ser suyo y tener al menos una foto.
   */
  async dayForCheckin(clientId, dayId) {
    const day = await progressMediaDao.findById(dayId);
    if (!day || String(day.userId) !== String(clientId)) return null;
    return (day.photos || []).length ? day : null;
  },

  async linkCheckin(dayId, responseId, trainerId) {
    await progressMediaDao.linkCheckin(dayId, responseId, trainerId);
  },

  /** Vista de un día concreto para el profesional que pidió el check-in. */
  async dayViewForTrainer(trainerId, clientId, dayId, { baseUrl } = {}) {
    const day = await progressMediaDao.findById(dayId);
    if (!day || String(day.userId) !== String(clientId)) return null;
    const relations = await trainerClientDao.findActiveRelationsOfPair(trainerId, clientId);
    const ok = trainerCanSeeProgressDay(day, {
      trainerId,
      relationStart: relationStartOf(relations),
      historyShared: relations.some((relation) => relation.mediaHistorySharedAt),
    });
    if (!ok) return null;
    const [view] = await viewsOfDays([day], { baseUrl, userId: clientId, ownAnthropometry: false, trainerId });
    return view;
  },
};
