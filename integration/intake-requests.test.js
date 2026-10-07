const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Almacenamiento local de media (sin R2/Bunny), como media-progress.test.js.
process.env.MEDIA_LOCAL = "1";
const h = require("./support/harness");

// Lo que el profesional pide en el cuestionario de alta además de preguntas:
// medidas (obligatorias u opcionales), fotos de inicio y vídeos con lo que
// tiene que grabar. Se configura al invitar, se copia al par con la
// invitación y el cliente lo manda con su cuestionario: las medidas van a
// sus medidas de ese día y las fotos y vídeos a su progreso, enviados a ese
// profesional (los ve siempre, como lo de un check-in).

const ctx = h.setup();
const LOCAL_ROOT = path.resolve(__dirname, "../.media-local");
const createdKeys = new Set();

after(async () => {
  for (const key of createdKeys) await fs.promises.rm(path.join(LOCAL_ROOT, key), { force: true }).catch(() => {});
});

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
const MP4 = Buffer.concat([Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.alloc(4096, 3)]);

const invite = (trainer, client, scopes = ["training"]) =>
  ctx.call(trainer, "POST", "/trainer/invites", { clientEmail: client.email, scopes });
const respond = (client, trainer, decision = "accept") => ctx.call(client, "POST", `/trainer/invites/${trainer._id}/${decision}`);

async function inviteAndAccept(trainer, client, scopes = ["training"]) {
  const res = await invite(trainer, client, scopes);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const accepted = await respond(client, trainer);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
}

const configure = (trainer, config) => ctx.put(trainer, "/trainer/intake-config", { enabledFields: ["goals"], ...config });
const submit = (client, trainer, body = {}) => ctx.call(client, "POST", "/trainer/intake", { trainerId: trainer.id, goals: "Fuerza", ...body });
const formOf = async (client, trainerId) =>
  (await ctx.get(client, "/trainer/onboarding-status")).professionals.find((p) => String(p.trainerId) === String(trainerId));

async function upload(user, { purpose, mime, bytes, durationSec }) {
  const signed = await ctx.call(user, "POST", "/media/uploads", { purpose, mime, bytes: bytes.length, durationSec });
  assert.equal(signed.status, 201, JSON.stringify(signed.body));
  const put = await fetch(signed.body.upload.url, { method: "PUT", headers: signed.body.upload.headers, body: bytes });
  assert.equal(put.status, 200);
  const done = await ctx.call(user, "POST", `/media/uploads/${signed.body.assetId}/complete`);
  assert.equal(done.status, 200, JSON.stringify(done.body));
  createdKeys.add((await ctx.model("MediaAsset").findById(signed.body.assetId).lean()).key);
  return signed.body.assetId;
}

// Una foto de `pose` en el día de hoy del cliente. Devuelve el _id del día.
async function photoToday(client, pose) {
  const assetId = await upload(client, { purpose: "progress_photo", mime: "image/jpeg", bytes: JPEG });
  const res = await ctx.put(client, `/progress-media/mine/${h.day(0)}/photos/${pose}`, { assetId });
  return String(res.day.id || res.day._id);
}

// Un vídeo de progreso colgado de hoy, con lo que se grabó como nota.
async function videoToday(client, note) {
  const assetId = await upload(client, { purpose: "progress_video", mime: "video/mp4", bytes: MP4, durationSec: 20 });
  await ctx.post(client, `/progress-media/mine/${h.day(0)}/videos`, { assetId, note });
  return assetId;
}

// --- Configuración ------------------------------------------------------------------

test("configuración: medidas, fotos y vídeos se validan, se guardan en el usuario del profesional y los vídeos conservan su id", async () => {
  const trainer = await ctx.makeTrainer();
  const initial = await ctx.get(trainer, "/trainer/intake-config");
  assert.deepEqual([initial.measurements, initial.photos, initial.videos], [[], null, []], "sin configurar no se pide nada");

  const rejected = [
    [{ measurements: [{ key: "inventada" }] }, "INVALID_INTAKE_MEASUREMENTS"],
    [{ measurements: [{ key: "weight", required: true }] }, "INVALID_INTAKE_MEASUREMENTS"],
    [{ photos: { poses: [] } }, "INVALID_INTAKE_PHOTOS"],
    [{ photos: { poses: ["extra"] } }, "INVALID_INTAKE_PHOTOS"],
    [{ videos: [{ label: "   " }] }, "INVALID_INTAKE_VIDEOS"],
    [{ videos: Array.from({ length: 6 }, (_, i) => ({ label: `Vídeo ${i}` })) }, "INVALID_INTAKE_VIDEOS"],
  ];
  for (const [body, code] of rejected) {
    const res = await ctx.call(trainer, "PUT", "/trainer/intake-config", { enabledFields: ["goals"], ...body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.code, code, JSON.stringify(body));
  }

  const saved = await configure(trainer, {
    measurements: [{ key: "perimeter_hip" }, { key: "perimeter_waist", required: true }],
    photos: { poses: ["side", "front"], required: true },
    videos: [
      { label: "Sentadilla sin peso, de perfil", required: true },
      { label: "Movilidad de hombro", enabled: false },
    ],
  });
  assert.deepEqual(saved.measurements, [
    { key: "perimeter_waist", required: true },
    { key: "perimeter_hip", required: false },
  ], "en el orden del catálogo");
  assert.deepEqual(saved.photos, { poses: ["front", "side"], required: true });
  assert.deepEqual(saved.videos.map((v) => [v.label, v.required, v.enabled]), [
    ["Sentadilla sin peso, de perfil", true, true],
    ["Movilidad de hombro", false, false],
  ]);
  assert.ok(saved.videos.every((v) => /^[0-9a-f]{24}$/.test(String(v._id))));

  const resaved = await ctx.put(trainer, "/trainer/intake-config", saved);
  assert.deepEqual(resaved.videos.map((v) => String(v._id)), saved.videos.map((v) => String(v._id)), "volver a guardar conserva los ids");
  const stored = await ctx.model("User").findById(trainer.id).select("trainerSettings").lean();
  assert.equal(stored.trainerSettings.intake.measurements.length, 2);

  // Quitar las fotos es mandar null.
  assert.equal((await configure(trainer, { ...saved, photos: null })).photos, null);
});

// --- El formulario de cada cliente ---------------------------------------------------

test("el formulario se copia al invitar: cambiar la configuración después no cambia lo que se le pide a quien ya estaba invitado", async () => {
  const trainer = await ctx.makeTrainer();
  const [ana, bea, carla] = [await ctx.makeClient(), await ctx.makeClient(), await ctx.makeClient()];

  const first = await configure(trainer, {
    customQuestions: [{ label: "¿Turnos de noche?", type: "yes_no", required: true }],
    measurements: [{ key: "perimeter_waist", required: true }],
    videos: [{ label: "Sentadilla de perfil", required: true }],
  });
  await inviteAndAccept(trainer, ana);
  await invite(trainer, carla); // Carla no responde todavía.

  await configure(trainer, { measurements: [{ key: "perimeter_hip" }], photos: { poses: ["front"], required: false } });
  await inviteAndAccept(trainer, bea);

  const anaForm = await formOf(ana, trainer.id);
  assert.deepEqual(anaForm.intakeMeasurements, [{ key: "perimeter_waist", required: true }], "Ana conserva lo de su invitación");
  assert.equal(anaForm.intakePhotos, null);
  assert.deepEqual(anaForm.intakeVideos.map((v) => [String(v._id), v.label]), [[String(first.videos[0]._id), "Sentadilla de perfil"]]);
  assert.deepEqual(anaForm.intakeCustomQuestions.map((q) => q.label), ["¿Turnos de noche?"]);

  const beaForm = await formOf(bea, trainer.id);
  assert.deepEqual(beaForm.intakeMeasurements, [{ key: "perimeter_hip", required: false }], "Bea, lo de la suya");
  assert.deepEqual(beaForm.intakePhotos, { poses: ["front"], required: false });
  assert.deepEqual([beaForm.intakeVideos, beaForm.intakeCustomQuestions], [[], []]);

  // Ana responde a SU formulario: lo de la configuración nueva no se le exige.
  const answered = await submit(ana, trainer, {
    measurements: [{ key: "perimeter_waist", value: 80 }],
    customAnswers: [{ questionId: String(first.customQuestions[0]._id), value: false }],
    videos: [{ requestId: String(first.videos[0]._id), assetId: await (async () => {
      await ctx.post(ana, "/media/consent", {});
      return videoToday(ana, "Sentadilla de perfil");
    })() }],
  });
  assert.equal(answered.status, 201, JSON.stringify(answered.body));

  // Volver a invitar a quien aún no ha enviado nada le manda el formulario
  // nuevo; un scope más con quien ya lo envió no le abre otro.
  await ctx.call(trainer, "POST", "/trainer/invites", { clientEmail: carla.email, scopes: ["nutrition"] });
  await respond(carla, trainer);
  assert.deepEqual((await formOf(carla, trainer.id)).intakeMeasurements, [{ key: "perimeter_hip", required: false }]);

  await configure(trainer, { measurements: [{ key: "perimeter_neck", required: true }] });
  await inviteAndAccept(trainer, ana, ["nutrition"]);
  const pair = await ctx.model("TrainerClient").findOne({ trainerId: trainer._id, clientId: ana._id }).lean();
  assert.equal(pair.intakePending, false);
  assert.deepEqual(pair.intakeForm.measurements, [{ key: "perimeter_waist", required: true }]);
  assert.ok(pair.intakeForm.sentAt instanceof Date);
});

// --- Medidas --------------------------------------------------------------------------

test("medidas: las obligatorias se exigen, un valor imposible se rechaza y van a sus medidas de hoy sin pisar lo que apuntó él", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await configure(trainer, {
    measurements: [{ key: "perimeter_waist", required: true }, { key: "perimeter_hip" }, { key: "perimeter_neck" }, { key: "fat_mass" }],
  });
  await inviteAndAccept(trainer, client);
  // Lo que el cliente ya apuntó hoy por su cuenta.
  await ctx.model("Anthropometry").create({ userId: client._id, date: h.day(0), hip: 101 });

  const missing = await submit(client, trainer, { measurements: [{ key: "perimeter_hip", value: 99 }] });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "INVALID_INTAKE_MEASUREMENT");
  assert.match(missing.body.message, /Cintura/);

  const typo = await submit(client, trainer, { measurements: [{ key: "perimeter_waist", value: 8 }] });
  assert.equal(typo.body.code, "INVALID_INTAKE_MEASUREMENT", "8 cm de cintura es una errata, no un dato");

  const ok = await submit(client, trainer, {
    measurements: [
      { key: "perimeter_waist", value: "82,5" },
      { key: "perimeter_hip", value: 99 },
      { key: "fat_mass", value: 14.2 },
      { key: "perimeter_chest", value: 100 },
    ],
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const seen = await ctx.get(trainer, `/trainer/clients/${client.id}/intake`);
  assert.deepEqual(seen.measurements, [
    { key: "fat_mass", value: 14.2 },
    { key: "perimeter_waist", value: 82.5 },
    { key: "perimeter_hip", value: 99 },
  ], "lo que se pidió, en el orden del catálogo; lo no pedido (pecho) no se guarda");
  assert.equal(seen.measuredOn, h.day(0));
  assert.deepEqual(seen.requested.measurements.map((m) => m.key), ["fat_mass", "perimeter_neck", "perimeter_waist", "perimeter_hip"]);

  const today = await ctx.model("Anthropometry").findOne({ userId: client._id, date: h.day(0) }).lean();
  assert.equal(today.waist, 82.5);
  assert.equal(today.fatMass, 14.2);
  assert.equal(today.hip, 101, "lo que apuntó él no se pisa (el cuestionario guarda su valor igualmente)");
  assert.equal(today.chest, undefined);
  assert.deepEqual([...today.checkinFields].sort(), ["fatMass", "waist"], "marcadas como pedidas por el profesional");

  // El profesional corrige respuestas: las medidas del cliente no se tocan.
  const corrected = await ctx.put(trainer, `/trainer/clients/${client.id}/intake`, { goals: "Recomposición" });
  assert.equal(corrected.goals, "Recomposición");
  assert.equal(corrected.measurements.length, 3);
});

// --- Fotos ----------------------------------------------------------------------------

test("fotos de inicio: obligatorias exigen todas las poses pedidas; el día queda enviado y su profesional lo ve aunque se oculte", async () => {
  const trainer = await ctx.makeTrainer();
  const dietitian = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await configure(trainer, { photos: { poses: ["front", "side"], required: true } });
  await inviteAndAccept(trainer, client);
  await ctx.relate(dietitian, client, { scope: "nutrition" });
  await ctx.post(client, "/media/consent", {});

  const status = await ctx.get(client, "/trainer/onboarding-status");
  assert.deepEqual(status.uploads, { images: true, videos: true });

  const noPhotos = await submit(client, trainer);
  assert.equal(noPhotos.body.code, "INTAKE_PHOTOS_MISSING");

  const dayId = await photoToday(client, "front");
  const half = await submit(client, trainer, { photosDayId: dayId });
  assert.equal(half.body.code, "INTAKE_PHOTOS_MISSING");
  assert.match(half.body.message, /perfil/);

  // El día de otro cliente no vale (se trata como si no mandara ninguno).
  const other = await ctx.makeClient();
  await ctx.relate(trainer, other);
  await ctx.post(other, "/media/consent", {});
  const othersDay = await photoToday(other, "front");
  await photoToday(other, "side");
  assert.equal((await submit(client, trainer, { photosDayId: othersDay })).body.code, "INTAKE_PHOTOS_MISSING");

  await photoToday(client, "side");
  assert.equal((await submit(client, trainer, { photosDayId: dayId })).status, 201);

  const day = await ctx.model("ProgressMediaDay").findById(dayId).lean();
  assert.deepEqual(day.intakes.map((i) => String(i.trainerId)), [trainer.id], "enviado a ese profesional");
  const seen = await ctx.get(trainer, `/trainer/clients/${client.id}/intake`);
  assert.equal(seen.photosDayId, undefined, "el profesional recibe la vista, no el id");
  assert.deepEqual(seen.photos.photos.filter(Boolean).map((p) => p.pose), ["front", "side"]);
  assert.ok(seen.photos.photos.filter(Boolean).every((p) => /^https?:\/\//.test(p.asset.url)), "con enlaces firmados");
  assert.deepEqual(seen.requested.photos, { poses: ["front", "side"], required: true });

  // El cliente oculta el día: quien lo recibió lo sigue viendo, el resto no.
  await ctx.patch(client, `/progress-media/mine/${h.day(0)}`, { hiddenFromTrainers: true });
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/progress-media`)).days.length, 1);
  assert.equal((await ctx.get(dietitian, `/trainer/clients/${client.id}/progress-media`)).days.length, 0);
  const mine = await ctx.get(client, "/progress-media/mine");
  assert.equal((mine.days || mine)[0].answersIntake, true, "el cliente ve que lo mandó con su cuestionario");

  // Reenviar el cuestionario no duplica el enlace del día.
  await submit(client, trainer, { photosDayId: dayId });
  assert.equal((await ctx.model("ProgressMediaDay").findById(dayId).lean()).intakes.length, 1);
});

test("fotos opcionales: se puede enviar sin ellas; si borra después sus fotos, el profesional ya no las tiene", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await configure(trainer, { photos: { poses: ["front", "side", "back"], required: false } });
  await inviteAndAccept(trainer, client);
  assert.equal((await submit(client, trainer)).status, 201, "opcionales: sin fotos también vale");
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/intake`)).photos, null);

  await ctx.post(client, "/media/consent", {});
  const dayId = await photoToday(client, "back");
  assert.equal((await submit(client, trainer, { photosDayId: dayId })).status, 201, "las que quiera");
  assert.deepEqual((await ctx.get(trainer, `/trainer/clients/${client.id}/intake`)).photos.photos.filter(Boolean).map((p) => p.pose), ["back"]);

  await ctx.del(client, `/progress-media/mine/${h.day(0)}/photos/back`);
  assert.equal((await ctx.get(trainer, `/trainer/clients/${client.id}/intake`)).photos, null, "borrar es del cliente");
});

// --- Vídeos ---------------------------------------------------------------------------

test("vídeos pedidos: uno por petición y del propio cliente; el profesional los ve con lo que pidió grabar", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  const config = await configure(trainer, {
    videos: [
      { label: "Sentadilla sin peso, de perfil", required: true },
      { label: "Movilidad de hombro" },
      { label: "Ya no lo pido", required: true, enabled: false },
    ],
  });
  const [squat, shoulder] = config.videos.map((v) => String(v._id));
  await inviteAndAccept(trainer, client);
  const form = await formOf(client, trainer.id);
  assert.deepEqual(form.intakeVideos.map((v) => [String(v._id), v.label, v.required]), [
    [squat, "Sentadilla sin peso, de perfil", true],
    [shoulder, "Movilidad de hombro", false],
  ], "lo desactivado no se pide");

  await ctx.post(client, "/media/consent", {});
  const missing = await submit(client, trainer);
  assert.equal(missing.body.code, "INVALID_INTAKE_VIDEO");
  assert.match(missing.body.message, /Sentadilla/);

  // De otro cliente, o subido pero sin colgar de un día de progreso: no vale.
  const other = await ctx.makeClient();
  await ctx.relate(trainer, other);
  await ctx.post(other, "/media/consent", {});
  const othersVideo = await videoToday(other, "x");
  assert.equal((await submit(client, trainer, { videos: [{ requestId: squat, assetId: othersVideo }] })).body.code, "INVALID_INTAKE_VIDEO");
  const loose = await upload(client, { purpose: "progress_video", mime: "video/mp4", bytes: MP4, durationSec: 12 });
  assert.equal((await submit(client, trainer, { videos: [{ requestId: squat, assetId: loose }] })).body.code, "INVALID_INTAKE_VIDEO");

  const squatVideo = await videoToday(client, "Sentadilla sin peso, de perfil");
  const twice = await submit(client, trainer, {
    videos: [{ requestId: squat, assetId: squatVideo }, { requestId: shoulder, assetId: squatVideo }],
  });
  assert.equal(twice.body.code, "INVALID_INTAKE_VIDEO", "cada petición, su grabación");

  const ok = await submit(client, trainer, {
    videos: [{ requestId: squat, assetId: squatVideo }, { requestId: "inventada", assetId: loose }],
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));

  const seen = await ctx.get(trainer, `/trainer/clients/${client.id}/intake`);
  assert.deepEqual(seen.videos.map((v) => [v.requestId, v.label, Boolean(v.asset)]), [[squat, "Sentadilla sin peso, de perfil", true]]);
  assert.deepEqual(seen.requested.videos.map((v) => [v._id, v.required]), [[squat, true], [shoulder, false]]);
  const day = await ctx.model("ProgressMediaDay").findOne({ userId: client._id, date: h.day(0) }).lean();
  assert.deepEqual(day.intakes.map((i) => String(i.trainerId)), [trainer.id], "el día del vídeo queda enviado");

  // El profesional corrige respuestas: los vídeos del cliente no se tocan.
  assert.equal((await ctx.put(trainer, `/trainer/clients/${client.id}/intake`, { goals: "x" })).videos.length, 1);

  // Si el cliente lo borra de su progreso, el cuestionario conserva lo que
  // se pidió pero ya sin el archivo.
  await ctx.del(client, `/progress-media/mine/${h.day(0)}/videos/${squatVideo}`);
  const afterDelete = await ctx.get(trainer, `/trainer/clients/${client.id}/intake`);
  assert.deepEqual(afterDelete.videos.map((v) => [v.label, v.asset]), [["Sentadilla sin peso, de perfil", null]]);
});

// --- Sin almacenamiento ---------------------------------------------------------------

test("sin almacenamiento de archivos, las fotos y vídeos obligatorios dejan de exigirse (el cliente no podría subirlos)", async () => {
  const trainer = await ctx.makeTrainer();
  const client = await ctx.makeClient();
  await configure(trainer, {
    photos: { poses: ["front"], required: true },
    videos: [{ label: "Sentadilla", required: true }],
    measurements: [{ key: "perimeter_waist", required: true }],
  });
  await inviteAndAccept(trainer, client);

  process.env.MEDIA_LOCAL = "0";
  try {
    assert.deepEqual((await ctx.get(client, "/trainer/onboarding-status")).uploads, { images: false, videos: false });
    const missingMeasure = await submit(client, trainer);
    assert.equal(missingMeasure.body.code, "INVALID_INTAKE_MEASUREMENT", "las medidas sí se siguen exigiendo");
    assert.equal((await submit(client, trainer, { measurements: [{ key: "perimeter_waist", value: 80 }] })).status, 201);
  } finally {
    process.env.MEDIA_LOCAL = "1";
  }
});
