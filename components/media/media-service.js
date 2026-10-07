// Subidas y lecturas de fotos y vídeos (docs/plan-medidas-multimedia.md).
//
// El backend nunca mueve bytes: firma la subida, el móvil sube directo al
// almacenamiento, y al confirmar se comprueba que lo subido respeta lo
// firmado. Las URL de lectura se generan en cada lectura y caducan en 1 h.
//
// Las funciones que pueden fallar por reglas de negocio devuelven
// `{ error: { status, code, message } }` para que el controller responda con
// el código que la app necesita (p. ej. enseñar la card de premium).

const mediaDao = require("./media-dao");
const storage = require("./storage");
const { retryPending } = require("./media-purge");
const {
  validateUploadRequest,
  extensionFor,
  libraryBytesFor,
  FORM_CHECKS_PER_WEEK,
} = require("./media-catalog");
const { MEDIA_CONSENT_VERSION, canUploadMedia, hasMediaConsent, uploadBlockReason } = require("./media-access");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

const READ_TTL_SEC = 3600;
// Una subida sin confirmar pasadas 24 h ya no va a llegar.
const STALE_PENDING_MS = 24 * 3600 * 1000;
// Cada cuánto se pregunta a Bunny por un vídeo que sigue procesándose.
const PROCESSING_RECHECK_MS = 15 * 1000;

// Límite propio por usuario (una sesión de fotos son 3–4 subidas seguidas;
// el rateLimiter general, 5 por minuto por IP, se queda corto).
const UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const UPLOADS_PER_WINDOW = 40;
const uploadLog = new Map();

function fail(status, code, message) {
  return { error: { status, code, message } };
}

function hasRole(user, role) {
  return Array.isArray(user?.roles) && user.roles.includes(role);
}

function underUploadLimit(userId) {
  const now = Date.now();
  const recent = (uploadLog.get(userId) || []).filter((at) => now - at < UPLOAD_WINDOW_MS);
  if (recent.length >= UPLOADS_PER_WINDOW) {
    uploadLog.set(userId, recent);
    return false;
  }
  recent.push(now);
  uploadLog.set(userId, recent);
  return true;
}

async function access(user) {
  const isTrainer = hasRole(user, "trainer");
  const [hasRelation, hasTraining] = isTrainer
    ? [false, false]
    : await Promise.all([
        trainerClientDao.hasActiveTrainer(user._id),
        trainerClientDao.hasActiveTrainer(user._id, "training"),
      ]);
  return {
    canUpload: canUploadMedia(user, hasRelation),
    reason: uploadBlockReason(user, hasRelation),
    hasActiveTrainer: hasRelation,
    hasTrainingTrainer: hasTraining,
  };
}

function libraryFor(purpose) {
  return purpose === "technique_video" ? "trainer" : "client";
}

/** ¿Hay almacenamiento para este tipo? (en producción sin configurar, no). */
function storageAvailable(kind, purpose) {
  if (kind === "image") return Boolean(storage.imageDriver());
  return Boolean(storage.videoDriver(libraryFor(purpose))) && Boolean(storage.imageDriver());
}

async function readUrlOf(provider, key, baseUrl) {
  if (!key) return null;
  const driver = storage.imageDriverByName(provider);
  if (!driver) return null;
  return driver.readUrl(key, { baseUrl, ttlSec: READ_TTL_SEC });
}

async function refreshIfProcessing(asset) {
  if (asset.status !== "processing" || asset.provider !== "bunny") return asset;
  const lastCheck = asset.processingCheckedAt ? new Date(asset.processingCheckedAt).getTime() : 0;
  if (Date.now() - lastCheck < PROCESSING_RECHECK_MS) return asset;
  const driver = storage.bunnyByLibrary(asset.bunnyLibrary);
  if (!driver) return asset;
  try {
    const video = await driver.getVideo(asset.bunnyVideoId);
    const set = { processingCheckedAt: new Date() };
    if (video.status === "ready") {
      Object.assign(set, {
        status: "ready",
        readyAt: new Date(),
        playbackResolution: video.resolution,
        durationSec: video.durationSec || asset.durationSec,
        width: video.width || asset.width,
        height: video.height || asset.height,
      });
    } else if (video.status === "failed") {
      set.status = "failed";
    }
    return (await mediaDao.update(asset._id, set)) || asset;
  } catch (error) {
    console.error("[media] No se pudo consultar el vídeo en Bunny:", error.message);
    return asset;
  }
}

module.exports = {
  async status(user) {
    const { canUpload, reason, hasActiveTrainer, hasTrainingTrainer } = await access(user);
    return {
      enabled: storageAvailable("image") && storageAvailable("video", "progress_video"),
      imagesEnabled: storageAvailable("image"),
      videosEnabled: storageAvailable("video", "progress_video"),
      canUpload,
      reason,
      hasActiveTrainer,
      // Las revisiones de técnica solo existen con un entrenador de entrenamiento.
      hasTrainingTrainer,
      // Solo cuenta el consentimiento al texto vigente; si no, la app lo vuelve a pedir.
      consentAt: hasMediaConsent(user) ? user.mediaConsentAt : null,
      formChecksPerWeek: FORM_CHECKS_PER_WEEK,
      libraryBytes: hasRole(user, "trainer") ? libraryBytesFor(user) : null,
      libraryUsedBytes: hasRole(user, "trainer") ? await mediaDao.sumLibraryBytes(user._id) : null,
    };
  },

  /**
   * ¿Se pueden subir ahora fotos y vídeos de progreso? Sin almacenamiento
   * configurado, lo que se pida como obligatorio deja de poder exigirse.
   */
  uploadsAvailable() {
    return { images: storageAvailable("image"), videos: storageAvailable("video", "progress_video") };
  },

  /**
   * De `ids`, los que son de `ownerId`, de uno de esos propósitos y están
   * subidos (listos o procesándose). Set de ids en texto.
   */
  async usableAssetIds(ownerId, ids, purposes) {
    const assets = await mediaDao.findByIds(ids);
    return new Set(
      assets
        .filter(
          (asset) =>
            String(asset.ownerId) === String(ownerId) &&
            purposes.includes(asset.purpose) &&
            ["ready", "processing"].includes(asset.status)
        )
        .map((asset) => String(asset._id))
    );
  },

  async giveConsent(user) {
    const at = await mediaDao.setConsent(user._id, MEDIA_CONSENT_VERSION);
    return { consentAt: at };
  },

  /**
   * Firma una subida. body: { purpose, mime, bytes, durationSec?, width?,
   * height?, thumbMime?, thumbBytes? }.
   */
  async createUpload(user, body, { baseUrl } = {}) {
    const checked = validateUploadRequest(body);
    if (checked.error) return fail(400, checked.code, checked.error);
    const def = checked.def;
    const purpose = body.purpose;

    if (def.uploader === "trainer" && !hasRole(user, "trainer")) {
      return fail(403, "MEDIA_FORBIDDEN", "Solo los entrenadores suben vídeos a su biblioteca");
    }
    if (def.uploader === "client") {
      const { canUpload } = await access(user);
      if (!canUpload) return fail(403, "MEDIA_PREMIUM_REQUIRED", "Hazte Premium para subir fotos y vídeos");
      if (!hasMediaConsent(user)) {
        return fail(403, "MEDIA_CONSENT_REQUIRED", "Antes de subir fotos tienes que aceptar cómo se guardan");
      }
    }
    if (purpose === "form_check") {
      const hasTraining = await trainerClientDao.hasActiveTrainer(user._id, "training");
      if (!hasTraining) {
        return fail(403, "FORM_CHECK_NO_TRAINER", "Necesitas un entrenador activo para enviarle vídeos");
      }
      const recent = await require("../formChecks/form-check-dao").countSince(user._id, new Date(Date.now() - 7 * 86400000));
      if (recent >= FORM_CHECKS_PER_WEEK) {
        return fail(429, "FORM_CHECK_WEEKLY_LIMIT", `Puedes enviar ${FORM_CHECKS_PER_WEEK} vídeos por semana`);
      }
    }
    if (purpose === "technique_video") {
      const used = await mediaDao.sumLibraryBytes(user._id);
      if (used + Number(body.bytes) > libraryBytesFor(user)) {
        return fail(403, "MEDIA_LIBRARY_FULL", "Tu biblioteca de vídeos está llena");
      }
    }
    if (!storageAvailable(def.kind, purpose)) {
      return fail(503, "MEDIA_UNAVAILABLE", "La subida de archivos no está disponible ahora mismo");
    }
    if (!underUploadLimit(String(user._id))) {
      return fail(429, "MEDIA_RATE_LIMIT", "Demasiadas subidas seguidas. Espera unos minutos.");
    }

    // Limpieza bajo demanda: subidas abandonadas de este usuario y borrados
    // remotos que fallaron antes.
    await mediaDao.deleteStalePending(user._id, new Date(Date.now() - STALE_PENDING_MS));
    retryPending().catch((error) => console.error("[media] Reintento de borrados:", error.message));

    const assetId = mediaDao.newId();
    const subjectId = user._id;
    const prefix = def.uploader === "trainer" ? `t/${subjectId}` : `u/${subjectId}`;
    const baseKey = `${prefix}/${purpose}/${assetId}`;
    const imageDriver = storage.imageDriver();
    const hasThumb = body.thumbMime != null;

    const asset = {
      _id: assetId,
      ownerId: user._id,
      subjectId,
      purpose,
      kind: def.kind,
      status: "pending",
      mime: String(body.mime).toLowerCase(),
      bytes: Number(body.bytes),
      width: Number(body.width) || null,
      height: Number(body.height) || null,
      durationSec: def.kind === "video" ? Math.round(Number(body.durationSec) * 10) / 10 : null,
      thumbProvider: hasThumb ? imageDriver.name : null,
      thumbKey: hasThumb ? `${baseKey}_t.${extensionFor(body.thumbMime)}` : null,
      thumbMime: hasThumb ? String(body.thumbMime).toLowerCase() : null,
      thumbBytes: hasThumb ? Number(body.thumbBytes) : null,
    };

    let upload;
    if (def.kind === "image") {
      asset.provider = imageDriver.name;
      asset.key = `${baseKey}.${extensionFor(asset.mime)}`;
      upload = await imageDriver.uploadTarget(asset.key, { mime: asset.mime, bytes: asset.bytes }, { baseUrl });
    } else {
      const videoDriver = storage.videoDriver(libraryFor(purpose));
      if (videoDriver.name === "bunny") {
        asset.provider = "bunny";
        asset.bunnyLibrary = videoDriver.library;
        asset.bunnyVideoId = await videoDriver.createVideo(`${purpose}-${assetId}`);
        upload = videoDriver.uploadTarget(asset.bunnyVideoId, { mime: asset.mime, title: `${purpose}-${assetId}` });
      } else {
        asset.provider = "local";
        asset.key = `${baseKey}.${extensionFor(asset.mime)}`;
        upload = await videoDriver.uploadTarget(asset.key, { mime: asset.mime, bytes: asset.bytes }, { baseUrl });
      }
    }

    const thumbUpload = hasThumb
      ? await imageDriver.uploadTarget(asset.thumbKey, { mime: asset.thumbMime, bytes: asset.thumbBytes }, { baseUrl })
      : null;

    await mediaDao.create(asset);
    return { assetId: String(assetId), upload, thumbUpload };
  },

  /** El móvil avisa de que terminó de subir. Se comprueba antes de darlo por bueno. */
  async completeUpload(user, assetId, { baseUrl } = {}) {
    const asset = await mediaDao.findById(assetId);
    if (!asset || String(asset.ownerId) !== String(user._id)) return fail(404, "MEDIA_NOT_FOUND", "Archivo no encontrado");
    if (asset.status !== "pending") return { asset: await this.viewOf(asset, { baseUrl }) };

    if (asset.thumbKey) {
      const thumb = await storage.imageDriverByName(asset.thumbProvider).head(asset.thumbKey);
      if (!thumb || thumb.bytes > asset.thumbBytes) return fail(400, "MEDIA_UPLOAD_INCOMPLETE", "La miniatura no llegó completa");
    }

    let set;
    if (asset.provider === "bunny") {
      set = { status: "processing", processingCheckedAt: null };
    } else {
      const driver = storage.imageDriverByName(asset.provider);
      const head = driver ? await driver.head(asset.key) : null;
      // Lo subido tiene que ser lo firmado: ni vacío ni más grande.
      if (!head || head.bytes === 0 || head.bytes > asset.bytes) {
        return fail(400, "MEDIA_UPLOAD_INCOMPLETE", "El archivo no llegó completo. Vuelve a intentarlo.");
      }
      set = { status: "ready", readyAt: new Date(), bytes: head.bytes };
    }
    let updated = await mediaDao.update(asset._id, set);
    updated = await refreshIfProcessing(updated);
    return { asset: await this.viewOf(updated, { baseUrl }) };
  },

  async cancelUpload(user, assetId) {
    const asset = await mediaDao.findById(assetId);
    if (!asset || String(asset.ownerId) !== String(user._id)) return fail(404, "MEDIA_NOT_FOUND", "Archivo no encontrado");
    if (asset.status === "pending") await mediaDao.deleteByIds([asset._id]);
    return { ok: true };
  },

  /**
   * Comprueba que un asset es de este usuario, del propósito esperado y está
   * listo (o procesándose) para colgarlo de un documento de dominio.
   */
  async assertAttachable(user, assetId, purposes) {
    const asset = await mediaDao.findById(assetId);
    if (!asset || String(asset.ownerId) !== String(user._id)) return fail(404, "MEDIA_NOT_FOUND", "Archivo no encontrado");
    if (!purposes.includes(asset.purpose)) return fail(400, "MEDIA_WRONG_PURPOSE", "Ese archivo no sirve aquí");
    if (!["ready", "processing"].includes(asset.status)) {
      return fail(400, "MEDIA_UPLOAD_INCOMPLETE", "El archivo aún no ha terminado de subir");
    }
    return { asset };
  },

  /** Vista pública de un asset, con URL firmadas de vida corta. */
  async viewOf(asset, { baseUrl } = {}) {
    if (!asset) return null;
    const fresh = await refreshIfProcessing(asset);
    let url = null;
    if (fresh.status === "ready") {
      if (fresh.provider === "bunny") {
        const driver = storage.bunnyByLibrary(fresh.bunnyLibrary);
        url = driver ? driver.playbackUrl(fresh.bunnyVideoId, fresh.playbackResolution, { ttlSec: READ_TTL_SEC }) : null;
      } else {
        url = await readUrlOf(fresh.provider, fresh.key, baseUrl);
      }
    }
    return {
      id: String(fresh._id),
      purpose: fresh.purpose,
      kind: fresh.kind,
      status: fresh.status,
      url,
      thumbUrl: fresh.status === "failed" ? null : await readUrlOf(fresh.thumbProvider, fresh.thumbKey, baseUrl),
      mime: fresh.mime,
      bytes: fresh.bytes,
      width: fresh.width,
      height: fresh.height,
      durationSec: fresh.durationSec,
      createdAt: fresh.createdAt,
      // Cuándo caducan las URL: la app las cachea hasta entonces.
      urlExpiresAt: new Date(Date.now() + READ_TTL_SEC * 1000 - 60 * 1000),
    };
  },

  /** Vistas de varios assets, en un Map id → vista. */
  async viewsByIds(ids, { baseUrl } = {}) {
    const assets = await mediaDao.findByIds(ids);
    const views = await Promise.all(assets.map((asset) => this.viewOf(asset, { baseUrl })));
    return new Map(views.filter(Boolean).map((view) => [view.id, view]));
  },

  async deleteAssets(ids) {
    await mediaDao.deleteByIds(ids);
  },

  /**
   * Webhook de Bunny. No se fía del cuerpo: con el guid vuelve a preguntar a
   * la API, así que un aviso falso solo provoca una consulta de más.
   */
  async handleBunnyWebhook(body) {
    const videoId = body?.VideoGuid || body?.videoGuid;
    if (!videoId) return;
    const asset = await mediaDao.findByBunnyVideoId(String(videoId));
    if (!asset) return;
    await refreshIfProcessing({ ...asset, processingCheckedAt: null });
  },
};
