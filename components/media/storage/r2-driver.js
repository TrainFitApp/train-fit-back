// Cloudflare R2 (API S3): fotos y miniaturas. Bucket privado con
// jurisdicción UE. El móvil sube directo con una URL prefirmada de un solo
// objeto; la lectura también va firmada y caduca en 1 h.
//
// CORS del bucket: debe permitir PUT y GET desde capacitor://localhost (iOS),
// https://localhost (Android) y los dominios web de las apps.

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

let client = null;
let clientConfig = null;

function s3(config) {
  if (!client || clientConfig !== config.endpoint) {
    client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    clientConfig = config.endpoint;
  }
  return client;
}

function create(config) {
  return {
    name: "r2",

    async uploadTarget(key, { mime, bytes }, { ttlSec = 600 } = {}) {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: mime,
        ContentLength: bytes,
      });
      const url = await getSignedUrl(s3(config), command, { expiresIn: ttlSec });
      return { method: "PUT", url, headers: { "Content-Type": mime } };
    },

    async readUrl(key, { ttlSec = 3600 } = {}) {
      const command = new GetObjectCommand({ Bucket: config.bucket, Key: key });
      return getSignedUrl(s3(config), command, { expiresIn: ttlSec });
    },

    async head(key) {
      try {
        const result = await s3(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return { bytes: Number(result.ContentLength) || 0 };
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NotFound") return null;
        throw error;
      }
    },

    async deleteKeys(keys) {
      const objects = keys.filter(Boolean).map((Key) => ({ Key }));
      // DeleteObjects admite hasta 1000 claves por llamada.
      for (let i = 0; i < objects.length; i += 1000) {
        await s3(config).send(
          new DeleteObjectsCommand({ Bucket: config.bucket, Delete: { Objects: objects.slice(i, i + 1000), Quiet: true } })
        );
      }
    },
  };
}

module.exports = { create };
