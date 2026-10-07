// Biblioteca de vídeos de técnica del entrenador (docs/plan-medidas-multimedia.md, pieza 3).
//
// Qué vídeo ve el cliente al abrir un ejercicio, de mayor a menor prioridad:
//   1. El que su entrenador le asignó a ÉL para ese ejercicio (override).
//   2. El vídeo por defecto de su entrenador para ese ejercicio.
//   3. Exercise.videoUrl del catálogo (lo resuelve la app, como hasta ahora).

const mongoose = require("mongoose");
const techniqueVideoDao = require("./technique-video-dao");
const mediaService = require("../media/media-service");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

const MAX_EXERCISES_PER_VIDEO = 50;

function fail(status, code, message) {
  return { error: { status, code, message } };
}

function parseYouTubeId(url) {
  const match = String(url || "").match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

function parseVimeoId(url) {
  const match = String(url || "").match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  return match ? match[1] : null;
}

// Enlace limpio y su plataforma ({ source, externalUrl }), o null si no es
// de YouTube ni de Vimeo.
function parseLink(url) {
  const externalUrl = String(url || "").trim();
  if (externalUrl.length > 500) return null;
  if (parseYouTubeId(externalUrl)) return { source: "youtube", externalUrl };
  if (parseVimeoId(externalUrl)) return { source: "vimeo", externalUrl };
  return null;
}

const badUrl = () => fail(400, "TECHNIQUE_VIDEO_BAD_URL", "Ese enlace no es de YouTube ni de Vimeo");

function trainerNameOf(trainer) {
  if (!trainer || typeof trainer !== "object") return "";
  return [trainer.name, trainer.lastname].filter(Boolean).join(" ");
}

function cleanExerciseIds(ids) {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.map(String).filter((id) => mongoose.isValidObjectId(id)))].slice(0, MAX_EXERCISES_PER_VIDEO);
}

async function viewsOf(videos, { baseUrl } = {}) {
  const assets = await mediaService.viewsByIds(
    videos.map((video) => video.assetId).filter(Boolean).map(String),
    { baseUrl }
  );
  return videos.map((video) => ({
    id: String(video._id),
    trainerId: String(video.trainerId?._id || video.trainerId),
    trainerName: trainerNameOf(video.trainerId),
    title: video.title,
    cues: video.cues || "",
    source: video.source,
    externalUrl: video.externalUrl || null,
    youtubeId: video.source === "youtube" ? parseYouTubeId(video.externalUrl) : null,
    vimeoId: video.source === "vimeo" ? parseVimeoId(video.externalUrl) : null,
    video: video.assetId ? assets.get(String(video.assetId)) || null : null,
    exercises: (video.exerciseIds || []).map((exercise) =>
      exercise && typeof exercise === "object" && exercise._id
        ? { id: String(exercise._id), name: exercise.name || "" }
        : { id: String(exercise), name: "" }
    ),
    updatedAt: video.updatedAt,
  }));
}

module.exports = {
  parseYouTubeId,
  parseVimeoId,
  parseLink,

  async viewsByIds(ids, { baseUrl } = {}) {
    const videos = await techniqueVideoDao.findByIds(ids);
    const views = await viewsOf(videos, { baseUrl });
    return new Map(views.map((view) => [view.id, view]));
  },

  // --- Lado profesional ---

  async listMine(trainer, { baseUrl } = {}) {
    const videos = await techniqueVideoDao.listByTrainer(trainer._id);
    return { videos: await viewsOf(videos, { baseUrl }) };
  },

  async create(trainer, body, { baseUrl } = {}) {
    const title = String(body?.title || "").trim().slice(0, 120);
    if (!title) return fail(400, "TECHNIQUE_VIDEO_NO_TITLE", "Ponle un título al vídeo");
    const source = body?.source;
    const data = {
      trainerId: trainer._id,
      title,
      cues: String(body?.cues || "").trim().slice(0, 1000),
      source,
      exerciseIds: cleanExerciseIds(body?.exerciseIds),
    };
    if (source === "upload") {
      const attachable = await mediaService.assertAttachable(trainer, body?.assetId, ["technique_video"]);
      if (attachable.error) return attachable;
      data.assetId = attachable.asset._id;
    } else if (source === "youtube" || source === "vimeo") {
      // Manda el enlace: pegar uno de Vimeo con YouTube marcado no es un error.
      const link = parseLink(body?.externalUrl);
      if (!link) return badUrl();
      Object.assign(data, link);
    } else {
      return fail(400, "TECHNIQUE_VIDEO_BAD_SOURCE", "Origen de vídeo no válido");
    }
    const created = await techniqueVideoDao.create(data);
    const [view] = await viewsOf([await techniqueVideoDao.findByIdWithExercises(created._id)], { baseUrl });
    return { video: view };
  },

  async update(trainer, id, body, { baseUrl } = {}) {
    const video = await techniqueVideoDao.findById(id);
    if (!video || String(video.trainerId) !== String(trainer._id)) return fail(404, "TECHNIQUE_VIDEO_NOT_FOUND", "Vídeo no encontrado");
    const set = {};
    if (typeof body?.title === "string") {
      const title = body.title.trim().slice(0, 120);
      if (!title) return fail(400, "TECHNIQUE_VIDEO_NO_TITLE", "Ponle un título al vídeo");
      set.title = title;
    }
    if (typeof body?.cues === "string") set.cues = body.cues.trim().slice(0, 1000);
    if (Array.isArray(body?.exerciseIds)) set.exerciseIds = cleanExerciseIds(body.exerciseIds);
    // El enlace de un vídeo de YouTube o Vimeo se puede cambiar, también de
    // una plataforma a otra: el origen sale del propio enlace. Un vídeo subido
    // no tiene enlace (pasarlo a enlace es borrarlo y crear otro).
    if (typeof body?.externalUrl === "string") {
      if (video.source === "upload") return fail(400, "TECHNIQUE_VIDEO_BAD_SOURCE", "Un vídeo subido no tiene enlace que cambiar");
      const link = parseLink(body.externalUrl);
      if (!link) return badUrl();
      Object.assign(set, link);
    }
    await techniqueVideoDao.update(video._id, set);
    const [view] = await viewsOf([await techniqueVideoDao.findByIdWithExercises(video._id)], { baseUrl });
    return { video: view };
  },

  async remove(trainer, id) {
    const video = await techniqueVideoDao.findById(id);
    if (!video || String(video.trainerId) !== String(trainer._id)) return fail(404, "TECHNIQUE_VIDEO_NOT_FOUND", "Vídeo no encontrado");
    await techniqueVideoDao.deleteById(video._id);
    return { ok: true };
  },

  async clientOverrides(trainerId, clientId) {
    const overrides = await techniqueVideoDao.listOverrides({ trainerId, clientId });
    return {
      overrides: overrides.map((override) => ({
        exerciseId: String(override.exerciseId),
        techniqueVideoId: String(override.techniqueVideoId),
      })),
    };
  },

  async setClientOverride(trainerId, clientId, exerciseId, techniqueVideoId) {
    if (!mongoose.isValidObjectId(exerciseId)) return fail(400, "TECHNIQUE_VIDEO_BAD_EXERCISE", "Ejercicio no válido");
    if (!techniqueVideoId) {
      await techniqueVideoDao.removeOverride(trainerId, clientId, exerciseId);
      return this.clientOverrides(trainerId, clientId);
    }
    const video = await techniqueVideoDao.findById(techniqueVideoId);
    if (!video || String(video.trainerId) !== String(trainerId)) return fail(404, "TECHNIQUE_VIDEO_NOT_FOUND", "Vídeo no encontrado");
    await techniqueVideoDao.setOverride(trainerId, clientId, exerciseId, video._id);
    return this.clientOverrides(trainerId, clientId);
  },

  // --- Lado cliente ---

  /**
   * Vídeos de sus entrenadores (relación de entrenamiento activa) por
   * ejercicio: { byExercise: { [exerciseId]: vista + assignedToYou } }.
   */
  async forClient(clientId, { baseUrl } = {}) {
    const trainerIds = [...(await trainerClientDao.findActiveTrainerIds(clientId, "training"))];
    if (!trainerIds.length) return { byExercise: {} };

    const [overrides, defaults] = await Promise.all([
      techniqueVideoDao.listOverrides({ trainerIds, clientId }),
      techniqueVideoDao.listDefaultsOfTrainers(trainerIds),
    ]);
    const overrideVideos = await techniqueVideoDao.findByIds(overrides.map((override) => String(override.techniqueVideoId)));
    const allVideos = [...overrideVideos, ...defaults];
    const views = new Map((await viewsOf(allVideos, { baseUrl })).map((view) => [view.id, view]));

    const byExercise = {};
    // Por defecto primero (el más reciente gana: van ordenados por updatedAt desc)…
    for (const video of defaults) {
      for (const exerciseId of video.exerciseIds || []) {
        const key = String(exerciseId);
        if (!byExercise[key]) byExercise[key] = { ...views.get(String(video._id)), assignedToYou: false };
      }
    }
    // …y lo asignado a él pisa lo general.
    for (const override of overrides) {
      const view = views.get(String(override.techniqueVideoId));
      if (view) byExercise[String(override.exerciseId)] = { ...view, assignedToYou: true };
    }
    // Un vídeo subido que aún se procesa o falló no se ofrece.
    for (const [key, view] of Object.entries(byExercise)) {
      if (view.source === "upload" && view.video?.status !== "ready") delete byExercise[key];
    }
    return { byExercise };
  },
};
