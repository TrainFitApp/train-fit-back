// Borrado de archivos en remoto. Lo llama el hook de media-schema.js al
// borrar MediaAssets. Lo que falla (red, proveedor caído) se apunta en
// MediaPurge y se reintenta bajo demanda con `retryPending`; sin crons, como
// el resto del proyecto.

const mongoose = require("mongoose");
const storage = require("./storage");

const MediaPurgeSchema = new mongoose.Schema(
  {
    provider: { type: String, enum: ["r2", "bunny", "local"], required: true },
    key: { type: String, default: null },
    bunnyLibrary: { type: String, default: null },
    bunnyVideoId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "mediapurges" }
);

const MediaPurge = mongoose.models.MediaPurge || mongoose.model("MediaPurge", MediaPurgeSchema);

// Cuántas veces se reintenta un borrado antes de dejarlo para revisión manual.
const MAX_ATTEMPTS = 10;

function targetsOf(asset) {
  const targets = [];
  if (asset.provider === "bunny" && asset.bunnyVideoId) {
    targets.push({ provider: "bunny", bunnyLibrary: asset.bunnyLibrary, bunnyVideoId: asset.bunnyVideoId });
  } else if (asset.key) {
    targets.push({ provider: asset.provider, key: asset.key });
  }
  if (asset.thumbKey && asset.thumbProvider) {
    targets.push({ provider: asset.thumbProvider, key: asset.thumbKey });
  }
  return targets;
}

async function deleteTarget(target) {
  if (target.provider === "bunny") {
    const driver = storage.bunnyByLibrary(target.bunnyLibrary);
    if (!driver) throw new Error("Bunny sin configurar");
    await driver.deleteVideo(target.bunnyVideoId);
    return;
  }
  const driver = storage.imageDriverByName(target.provider);
  if (!driver) throw new Error(`Almacenamiento ${target.provider} sin configurar`);
  await driver.deleteKeys([target.key]);
}

async function purgeTargets(targets) {
  for (const target of targets) {
    try {
      await deleteTarget(target);
    } catch (error) {
      console.error("[media] No se pudo borrar un archivo; queda pendiente de reintento:", error.message);
      await MediaPurge.create({ ...target, attempts: 1, lastError: String(error.message).slice(0, 300) });
    }
  }
}

async function purgeAssets(assets) {
  await purgeTargets(assets.flatMap(targetsOf));
}

/** Reintenta hasta `limit` borrados pendientes. Barato si no hay ninguno. */
async function retryPending(limit = 20) {
  const pending = await MediaPurge.find({ attempts: { $lt: MAX_ATTEMPTS } }).sort({ createdAt: 1 }).limit(limit);
  for (const item of pending) {
    try {
      await deleteTarget(item);
      await MediaPurge.deleteOne({ _id: item._id });
    } catch (error) {
      await MediaPurge.updateOne(
        { _id: item._id },
        { $inc: { attempts: 1 }, $set: { lastError: String(error.message).slice(0, 300) } }
      );
    }
  }
}

module.exports = { purgeAssets, retryPending, MediaPurge };
