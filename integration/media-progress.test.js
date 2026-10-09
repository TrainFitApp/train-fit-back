const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Almacenamiento local de media (sin R2/Bunny): MEDIA_LOCAL=1 antes de cargar
// la app. Los archivos van a .media-local/ (fuera de git) y se borran al final.
process.env.MEDIA_LOCAL = "1";
const h = require("./support/harness");

// Fotos de progreso de punta a punta: permisos para subir (premium o con
// profesional + consentimiento), firma, subida, verificación de lo subido,
// enganche al día de progreso y quién lo ve (y desde cuándo).

const ctx = h.setup();
const LOCAL_ROOT = path.resolve(__dirname, "../.media-local");
const createdKeys = new Set();

after(async () => {
  for (const key of createdKeys) await fs.promises.rm(path.join(LOCAL_ROOT, key), { force: true }).catch(() => {});
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);

async function clientWithTrainer() {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await ctx.relate(trainer, client, { scope: "training", respondedAt: new Date(Date.now() - 30 * 86400000) });
  return { trainer, client };
}

async function uploadPhoto(user, bytes = JPEG) {
  const signed = await ctx.call(user, "POST", "/media/uploads", { purpose: "progress_photo", mime: "image/jpeg", bytes: bytes.length });
  assert.equal(signed.status, 201, JSON.stringify(signed.body));
  const put = await fetch(signed.body.upload.url, { method: "PUT", headers: signed.body.upload.headers, body: bytes });
  assert.equal(put.status, 200);
  const done = await ctx.call(user, "POST", `/media/uploads/${signed.body.assetId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  const asset = await ctx.model("MediaAsset").findById(signed.body.assetId).lean();
  createdKeys.add(asset.key);
  return { assetId: signed.body.assetId, asset };
}

test("subir fotos: free sin profesional NO; con profesional exige consentimiento; tras aceptarlo sí", async () => {
  const lonely = await ctx.makeClient();
  const status = await ctx.get(lonely, "/media/status");
  assert.equal(status.canUpload, false);
  assert.equal((await ctx.call(lonely, "POST", "/media/uploads", { purpose: "progress_photo", mime: "image/jpeg", bytes: 10 })).body.code, "MEDIA_PREMIUM_REQUIRED");

  const { client } = await clientWithTrainer();
  assert.equal((await ctx.call(client, "POST", "/media/uploads", { purpose: "progress_photo", mime: "image/jpeg", bytes: 10 })).body.code, "MEDIA_CONSENT_REQUIRED");
  await ctx.post(client, "/media/consent", {});
  assert.ok((await ctx.get(client, "/media/status")).consentAt);
  const signed = await ctx.call(client, "POST", "/media/uploads", { purpose: "progress_photo", mime: "image/jpeg", bytes: 10 });
  assert.equal(signed.status, 201);
});

test("validación de la petición de subida: propósito, formato, tamaño y duración", async () => {
  const { client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const cases = [
    [{ purpose: "__proto__", mime: "image/jpeg", bytes: 10 }, "MEDIA_INVALID_PURPOSE"],
    [{ purpose: "progress_photo", mime: "image/gif", bytes: 10 }, "MEDIA_INVALID_FORMAT"],
    [{ purpose: "progress_photo", mime: "image/jpeg", bytes: 0 }, "MEDIA_EMPTY"],
    [{ purpose: "progress_photo", mime: "image/jpeg", bytes: 50 * 1024 * 1024 }, "MEDIA_TOO_LARGE"],
    [{ purpose: "progress_video", mime: "video/mp4", bytes: 1000 }, "MEDIA_NO_DURATION"],
    [{ purpose: "progress_video", mime: "video/mp4", bytes: 1000, durationSec: 400 }, "MEDIA_TOO_LONG"],
    [{ purpose: "technique_video", mime: "video/mp4", bytes: 1000, durationSec: 10 }, "MEDIA_FORBIDDEN"],
  ];
  for (const [body, code] of cases) {
    const res = await ctx.call(client, "POST", "/media/uploads", body);
    assert.equal(res.body.code, code, JSON.stringify(body));
  }
  assert.equal(await ctx.count("MediaAsset", { ownerId: client._id }), 0);
});

test("completar una subida comprueba lo subido: sin archivo, 400; de otro usuario, 404; más grande de lo firmado, 413", async () => {
  const { client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const signed = await ctx.post(client, "/media/uploads", { purpose: "progress_photo", mime: "image/jpeg", bytes: 100 });
  assert.equal((await ctx.call(client, "POST", `/media/uploads/${signed.assetId}/complete`)).body.code, "MEDIA_UPLOAD_INCOMPLETE");

  const other = await ctx.makeClient();
  assert.equal((await ctx.call(other, "POST", `/media/uploads/${signed.assetId}/complete`)).status, 404);

  const tooBig = await fetch(signed.upload.url, { method: "PUT", headers: signed.upload.headers, body: Buffer.alloc(5000, 1) });
  assert.equal(tooBig.status, 413);

  // Un token manipulado no sirve para subir.
  const forged = signed.upload.url.replace(/\.[^.]+$/, ".firmafalsa");
  assert.equal((await fetch(forged, { method: "PUT", body: JPEG })).status, 403);
});

test("foto de progreso: el cliente la cuelga en su día y su entrenador la ve con un enlace firmado que descarga lo mismo", async () => {
  const { trainer, client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const { assetId } = await uploadPhoto(client);

  const day = await ctx.call(client, "PUT", `/progress-media/mine/${h.day(0)}/photos/front`, { assetId });
  assert.equal(day.status, 200, JSON.stringify(day.body));
  const mine = await ctx.get(client, "/progress-media/mine");
  assert.equal(mine.days?.length ?? mine.length, 1);

  const seen = await ctx.get(trainer, `/trainer/clients/${client.id}/progress-media`);
  assert.equal(seen.days.length, 1);
  const photoUrl = JSON.stringify(seen.days[0]).match(/https?:\/\/[^"]+\/api\/media\/local\/[^"]+/)?.[0];
  assert.ok(photoUrl, "el entrenador recibe un enlace firmado");
  const download = await fetch(photoUrl);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), JPEG);

  // Otro entrenador sin relación: nada.
  const stranger = await ctx.makeTrainer();
  assert.equal((await ctx.call(stranger, "GET", `/trainer/clients/${client.id}/progress-media`)).status, 403);
});

test("ocultar un día al entrenador lo quita de su ficha; volver a mostrarlo lo devuelve", async () => {
  const { trainer, client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const { assetId } = await uploadPhoto(client);
  await ctx.put(client, `/progress-media/mine/${h.day(0)}/photos/side`, { assetId });
  await ctx.patch(client, `/progress-media/mine/${h.day(0)}`, { hiddenFromTrainers: true });
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/progress-media`)).days.length, 0);
  await ctx.patch(client, `/progress-media/mine/${h.day(0)}`, { hiddenFromTrainers: false });
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/progress-media`)).days.length, 1);
});

test("fotos anteriores a la relación: el entrenador solo las ve si el cliente comparte su historial", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient({ fields: { premium: { entitled: true, expiresAt: new Date(Date.now() + 86400000) } } });
  await ctx.post(client, "/media/consent", {});
  const { assetId } = await uploadPhoto(client);
  await ctx.put(client, `/progress-media/mine/${h.day(-60)}/photos/front`, { assetId });
  await ctx.relate(trainer, client, { scope: "nutrition", respondedAt: new Date() });

  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/progress-media`)).days.length, 0, "lo anterior no se ve");
  await ctx.put(client, `/progress-media/mine/trainers/${trainer.id}/history`, { shared: true });
  const after = await ctx.get(trainer, `/trainer/clients/${client.id}/progress-media`);
  assert.equal(after.historyShared, true);
  assert.equal(after.days.length, 1);
  await ctx.put(client, `/progress-media/mine/trainers/${trainer.id}/history`, { shared: false });
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/progress-media`)).days.length, 0);
});

test("no se puede colgar en mi día una foto subida por otro, ni una a medio subir", async () => {
  const { client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const other = await clientWithTrainer();
  await ctx.post(other.client, "/media/consent", {});
  const { assetId } = await uploadPhoto(other.client);
  assert.equal((await ctx.call(client, "PUT", `/progress-media/mine/${h.day(0)}/photos/front`, { assetId })).status, 404);

  const pending = await ctx.post(client, "/media/uploads", { purpose: "progress_photo", mime: "image/jpeg", bytes: 100 });
  const res = await ctx.call(client, "PUT", `/progress-media/mine/${h.day(0)}/photos/front`, { assetId: pending.assetId });
  assert.ok(res.status >= 400, String(res.status));
});

test("quitar la foto del día borra el archivo y su registro", async () => {
  const { client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const { assetId, asset } = await uploadPhoto(client);
  await ctx.put(client, `/progress-media/mine/${h.day(0)}/photos/back`, { assetId });
  assert.ok(fs.existsSync(path.join(LOCAL_ROOT, asset.key)));
  await ctx.call(client, "DELETE", `/progress-media/mine/${h.day(0)}/photos/back`);
  assert.equal(await ctx.count("MediaAsset", { _id: assetId }), 0);
  assert.equal(fs.existsSync(path.join(LOCAL_ROOT, asset.key)), false, "el archivo también se borra");
});

test("fotos de varias poses colgadas a la vez en un día nuevo: se quedan todas", async () => {
  const { client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const poses = ["front", "side", "back", "extra"];
  const uploads = await Promise.all(poses.map(() => uploadPhoto(client)));

  // Frente y perfil terminan de subir juntas: las peticiones llegan a la vez.
  const responses = await Promise.all(
    poses.map((pose, i) => ctx.call(client, "PUT", `/progress-media/mine/${h.day(0)}/photos/${pose}`, { assetId: uploads[i].assetId }))
  );
  responses.forEach((res) => assert.equal(res.status, 200, JSON.stringify(res.body)));

  const days = await ctx.model("ProgressMediaDay").find({ userId: client._id }).lean();
  assert.equal(days.length, 1, "un solo día");
  assert.deepEqual(days[0].photos.map((photo) => photo.pose).sort(), [...poses].sort());
  assert.deepEqual(
    Object.fromEntries(days[0].photos.map((photo) => [photo.pose, String(photo.assetId)])),
    Object.fromEntries(poses.map((pose, i) => [pose, String(uploads[i].assetId)]))
  );
});

test("cambiar la foto de una pose borra la anterior, también con dos cambios a la vez: no quedan archivos huérfanos", async () => {
  const { client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const first = await uploadPhoto(client);
  await ctx.put(client, `/progress-media/mine/${h.day(0)}/photos/front`, { assetId: first.assetId });

  const [second, third] = await Promise.all([uploadPhoto(client), uploadPhoto(client)]);
  const responses = await Promise.all(
    [second, third].map(({ assetId }) => ctx.call(client, "PUT", `/progress-media/mine/${h.day(0)}/photos/front`, { assetId }))
  );
  responses.forEach((res) => assert.equal(res.status, 200, JSON.stringify(res.body)));

  const day = await ctx.model("ProgressMediaDay").findOne({ userId: client._id }).lean();
  assert.equal(day.photos.length, 1);
  const kept = String(day.photos[0].assetId);
  assert.ok([second.assetId, third.assetId].map(String).includes(kept));
  const remaining = await ctx.model("MediaAsset").find({ ownerId: client._id, purpose: "progress_photo" }).lean();
  assert.deepEqual(remaining.map((asset) => String(asset._id)), [kept], "solo queda la foto que está en el día");

  // Quitarla deja el día sin fotos y borra el archivo; quitarla otra vez no rompe nada.
  assert.equal((await ctx.call(client, "DELETE", `/progress-media/mine/${h.day(0)}/photos/front`)).status, 200);
  assert.equal((await ctx.call(client, "DELETE", `/progress-media/mine/${h.day(0)}/photos/front`)).status, 200);
  assert.equal(await ctx.count("MediaAsset", { ownerId: client._id, purpose: "progress_photo" }), 0);
});

test("borrar la cuenta borra sus fotos del almacenamiento", async () => {
  const { client } = await clientWithTrainer();
  await ctx.post(client, "/media/consent", {});
  const { assetId, asset } = await uploadPhoto(client);
  await ctx.put(client, `/progress-media/mine/${h.day(0)}/photos/front`, { assetId });
  assert.equal((await ctx.call(client, "DELETE", `/users/${client.id}`)).status, 204);
  assert.equal(await ctx.count("MediaAsset", { subjectId: client._id }), 0);
  assert.equal(await ctx.count("ProgressMediaDay", { userId: client._id }), 0);
  assert.equal(fs.existsSync(path.join(LOCAL_ROOT, asset.key)), false);
});

// --- Revisiones de técnica: un vídeo, una revisión ------------------------------

// El vídeo ya subido (local, listo): la subida real de vídeo la cubren los
// tests de fotos; aquí importa a qué revisión se cuelga.
async function readyFormCheckVideo(client) {
  return ctx.model("MediaAsset").create({
    ownerId: client._id,
    subjectId: client._id,
    purpose: "form_check",
    kind: "video",
    provider: "local",
    key: `test/form-check-${Date.now()}-${Math.random()}.mp4`,
    status: "ready",
    mime: "video/mp4",
    bytes: 1024,
    durationSec: 8,
  });
}

test("revisión de técnica: el mismo vídeo no cuelga de dos revisiones (409), ni enviándolo dos veces a la vez", async () => {
  const { trainer, client } = await clientWithTrainer();
  const video = await readyFormCheckVideo(client);
  const body = { assetId: String(video._id), exerciseName: "Sentadilla" };

  const first = await ctx.call(client, "POST", "/form-checks/mine", body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const again = await ctx.call(client, "POST", "/form-checks/mine", body);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "FORM_CHECK_ASSET_IN_USE");

  // Doble toque en «Enviar»: dos peticiones a la vez con otro vídeo.
  const other = await readyFormCheckVideo(client);
  const both = await Promise.all([1, 2].map(() => ctx.call(client, "POST", "/form-checks/mine", { ...body, assetId: String(other._id) })));
  assert.deepEqual(both.map((res) => res.status).sort(), [201, 409]);
  assert.equal(await ctx.model("FormCheck").countDocuments({ assetId: other._id }), 1);

  // Borrar una revisión no deja a otra sin vídeo: cada una tiene el suyo.
  const kept = both.find((res) => res.status === 201).body.formCheck;
  assert.equal((await ctx.call(client, "DELETE", `/form-checks/mine/${first.body.formCheck.id}`)).status, 200);
  assert.equal(await ctx.model("MediaAsset").exists({ _id: video._id }), null, "el vídeo de la borrada se va con ella");
  assert.ok(await ctx.model("MediaAsset").exists({ _id: other._id }), "el de la otra sigue");
  const forTrainer = await ctx.call(trainer, "GET", `/trainer/form-checks/${kept.id}`);
  assert.equal(forTrainer.status, 200);
});

test("revisión de técnica borrada por el cliente: el aviso del entrenador desaparece (antes abría un 404)", async () => {
  const { trainer, client } = await clientWithTrainer();
  const video = await readyFormCheckVideo(client);
  const created = await ctx.call(client, "POST", "/form-checks/mine", { assetId: String(video._id), exerciseName: "Press banca" });
  assert.equal(created.status, 201);
  const id = created.body.formCheck.id;
  const notices = () => ctx.model("Notification").countDocuments({ trainerId: trainer._id, type: "form_check_submitted", "payload.formCheckId": id });
  assert.equal(await notices(), 1);

  assert.equal((await ctx.call(client, "DELETE", `/form-checks/mine/${id}`)).status, 200);
  assert.equal(await notices(), 0);
});
