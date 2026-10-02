// Bunny Stream: vídeos. Transcodifica gratis (los .mov HEVC del iPhone no se
// reproducen en el Chrome de escritorio de la app de entrenador), y el móvil
// sube directo por TUS con una firma válida para un único vídeo.
//
// Configuración que necesita cada librería en el panel de Bunny:
//   - "MP4 fallback" activado: la app reproduce el MP4 (<video>), lo que
//     permite saltar a un segundo exacto desde los comentarios.
//   - Resoluciones: client 360p/720p, trainer 480p/720p/1080p. Sin guardar
//     el original.
//   - Token Authentication activado en la pull zone (CDN_TOKEN_KEY).
//   - Webhook → POST {API}/api/media/webhooks/bunny.

const crypto = require("crypto");
const axios = require("axios");

const API = "https://video.bunnycdn.com";
const TUS_ENDPOINT = "https://video.bunnycdn.com/tusupload";

// Estado del vídeo en la API de Bunny (no el del webhook, que es otro enum).
const VIDEO_STATUS = { FINISHED: 4, ERROR: 5, UPLOAD_FAILED: 6 };

// Resolución que se reproduce: la mejor disponible hasta 720p. Es un vídeo
// de técnica visto en un móvil; más no aporta y cuesta el doble de datos.
const PLAYBACK_PREFERENCE = ["720p", "480p", "360p", "240p", "1080p"];

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function pickResolution(available) {
  const list = String(available || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return PLAYBACK_PREFERENCE.find((resolution) => list.includes(resolution)) || null;
}

function create(config) {
  const http = axios.create({
    baseURL: `${API}/library/${config.libraryId}`,
    headers: { AccessKey: config.apiKey, accept: "application/json" },
    timeout: 15000,
  });

  // URL firmada de la CDN (Token Authentication, variante SHA256).
  function signCdnUrl(pathname, ttlSec) {
    const base = `https://${config.cdnHost}${pathname}`;
    if (!config.cdnTokenKey) return base;
    const expires = Math.floor(Date.now() / 1000) + ttlSec;
    const token = crypto
      .createHash("sha256")
      .update(config.cdnTokenKey + pathname + expires)
      .digest("base64")
      .replace(/\n/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
    return `${base}?token=${token}&expires=${expires}`;
  }

  return {
    name: "bunny",
    library: config.library,

    async createVideo(title) {
      const { data } = await http.post("/videos", { title });
      return data.guid;
    },

    // Cabeceras TUS: AuthorizationSignature = sha256(libraryId + apiKey +
    // expiración + videoId). La clave nunca sale del servidor.
    uploadTarget(videoId, { mime, title }, { ttlSec = 2 * 3600 } = {}) {
      const expire = Math.floor(Date.now() / 1000) + ttlSec;
      return {
        method: "TUS",
        url: TUS_ENDPOINT,
        headers: {
          AuthorizationSignature: sha256Hex(config.libraryId + config.apiKey + expire + videoId),
          AuthorizationExpire: String(expire),
          VideoId: videoId,
          LibraryId: config.libraryId,
        },
        metadata: { filetype: mime, title: title || videoId },
      };
    },

    /** Estado normalizado: { status: processing|ready|failed, durationSec, width, height, resolution }. */
    async getVideo(videoId) {
      const { data } = await http.get(`/videos/${videoId}`);
      const resolution = pickResolution(data.availableResolutions);
      let status = "processing";
      if (data.status === VIDEO_STATUS.FINISHED && resolution) status = "ready";
      if (data.status === VIDEO_STATUS.ERROR || data.status === VIDEO_STATUS.UPLOAD_FAILED) status = "failed";
      return {
        status,
        durationSec: Number(data.length) || null,
        width: Number(data.width) || null,
        height: Number(data.height) || null,
        resolution,
      };
    },

    playbackUrl(videoId, resolution, { ttlSec = 3600 } = {}) {
      return signCdnUrl(`/${videoId}/play_${resolution || "720p"}.mp4`, ttlSec);
    },

    async deleteVideo(videoId) {
      try {
        await http.delete(`/videos/${videoId}`);
      } catch (error) {
        if (error?.response?.status === 404) return;
        throw error;
      }
    },
  };
}

module.exports = { create, pickResolution };
