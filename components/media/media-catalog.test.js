const test = require("node:test");
const assert = require("node:assert/strict");

const catalog = require("./media-catalog");
const {
  validateUploadRequest,
  extensionFor,
  libraryBytesFor,
  PURPOSE_IDS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_THUMB_BYTES,
  MAX_VIDEO_SECONDS,
} = catalog;

// El backend nunca recibe los bytes: con esto FIRMA la subida y, al
// confirmarla, comprueba que lo subido respeta lo firmado. Si esta validación
// deja pasar algo, se firma una subida que luego no se puede rechazar.

const MB = 1024 * 1024;
const photo = (over = {}) => ({
  purpose: "progress_photo",
  mime: "image/jpeg",
  bytes: 400 * 1024,
  ...over,
});
const video = (over = {}) => ({
  purpose: "progress_video",
  mime: "video/mp4",
  bytes: 50 * MB,
  durationSec: 60,
  ...over,
});

// --- propósito --------------------------------------------------------------

test("una petición válida devuelve el propósito del catálogo", () => {
  const result = validateUploadRequest(photo());
  assert.equal(result.error, undefined);
  assert.equal(result.def.kind, "image");
});

test("un propósito que no está en el catálogo se rechaza", () => {
  for (const purpose of ["inventado", "", null, undefined, "__proto__", "constructor"]) {
    const result = validateUploadRequest({ ...photo(), purpose });
    assert.equal(result.code, "MEDIA_INVALID_PURPOSE", `propósito ${String(purpose)}`);
  }
});

test("sin argumentos no revienta: rechaza por propósito", () => {
  assert.equal(validateUploadRequest().code, "MEDIA_INVALID_PURPOSE");
});

test("todos los propósitos del catálogo aceptan una subida válida de su tipo", () => {
  for (const purpose of PURPOSE_IDS) {
    const def = catalog.PURPOSES[purpose];
    const request =
      def.kind === "image"
        ? { purpose, mime: "image/jpeg", bytes: 1000 }
        : { purpose, mime: "video/mp4", bytes: 1000, durationSec: 10 };
    assert.equal(validateUploadRequest(request).error, undefined, purpose);
  }
});

// --- formato ----------------------------------------------------------------

test("una foto solo acepta formatos de imagen", () => {
  for (const mime of ["image/jpeg", "image/webp", "image/png", "IMAGE/JPEG"]) {
    assert.equal(validateUploadRequest(photo({ mime })).error, undefined, mime);
  }
  for (const mime of ["video/mp4", "application/pdf", "text/html", "", null]) {
    assert.equal(validateUploadRequest(photo({ mime })).code, "MEDIA_INVALID_FORMAT", String(mime));
  }
});

test("un vídeo acepta lo que graban iOS y Android", () => {
  for (const mime of ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/3gpp"]) {
    assert.equal(validateUploadRequest(video({ mime })).error, undefined, mime);
  }
  assert.equal(validateUploadRequest(video({ mime: "image/jpeg" })).code, "MEDIA_INVALID_FORMAT");
});

// --- tamaño -----------------------------------------------------------------

test("un archivo vacío o con tamaño ilegible se rechaza", () => {
  for (const bytes of [0, -1, null, undefined, "abc", NaN, Infinity]) {
    assert.equal(validateUploadRequest(photo({ bytes })).code, "MEDIA_EMPTY", String(bytes));
  }
});

test("la foto se corta justo en su tope", () => {
  assert.equal(validateUploadRequest(photo({ bytes: MAX_IMAGE_BYTES })).error, undefined);
  assert.equal(validateUploadRequest(photo({ bytes: MAX_IMAGE_BYTES + 1 })).code, "MEDIA_TOO_LARGE");
});

test("el vídeo se corta justo en su tope", () => {
  assert.equal(validateUploadRequest(video({ bytes: MAX_VIDEO_BYTES })).error, undefined);
  assert.equal(validateUploadRequest(video({ bytes: MAX_VIDEO_BYTES + 1 })).code, "MEDIA_TOO_LARGE");
});

test("el tope de la foto es mucho menor que el del vídeo", () => {
  // Protege de intercambiar las constantes por descuido: una foto de 1 GB
  // pasaría la validación y se firmaría.
  assert.ok(MAX_IMAGE_BYTES < MAX_VIDEO_BYTES);
});

// --- duración ---------------------------------------------------------------

test("un vídeo sin duración legible se rechaza", () => {
  for (const durationSec of [undefined, null, 0, -5, "abc", NaN]) {
    assert.equal(
      validateUploadRequest(video({ durationSec })).code,
      "MEDIA_NO_DURATION",
      String(durationSec),
    );
  }
});

test("el vídeo admite un segundo de margen sobre el máximo", () => {
  // El redondeo de los metadatos varía por móvil: sin margen, un vídeo de
  // justo 3 min se rechaza en unos terminales y en otros no.
  assert.equal(validateUploadRequest(video({ durationSec: MAX_VIDEO_SECONDS })).error, undefined);
  assert.equal(
    validateUploadRequest(video({ durationSec: MAX_VIDEO_SECONDS + 1 })).error,
    undefined,
  );
  assert.equal(
    validateUploadRequest(video({ durationSec: MAX_VIDEO_SECONDS + 2 })).code,
    "MEDIA_TOO_LONG",
  );
});

test("a una foto no se le pide duración", () => {
  assert.equal(validateUploadRequest(photo({ durationSec: undefined })).error, undefined);
});

// --- miniatura --------------------------------------------------------------

test("sin miniatura no se valida miniatura", () => {
  assert.equal(validateUploadRequest(photo()).error, undefined);
});

test("la miniatura tiene que ser una imagen", () => {
  const result = validateUploadRequest(photo({ thumbMime: "video/mp4", thumbBytes: 1000 }));
  assert.equal(result.code, "MEDIA_INVALID_FORMAT");
});

test("la miniatura se corta en su propio tope, mucho menor que la foto", () => {
  const ok = validateUploadRequest(
    photo({ thumbMime: "image/jpeg", thumbBytes: MAX_THUMB_BYTES }),
  );
  assert.equal(ok.error, undefined);
  const tooBig = validateUploadRequest(
    photo({ thumbMime: "image/jpeg", thumbBytes: MAX_THUMB_BYTES + 1 }),
  );
  assert.equal(tooBig.code, "MEDIA_INVALID_THUMB");
  assert.ok(MAX_THUMB_BYTES < MAX_IMAGE_BYTES);
});

test("mandar solo uno de los dos campos de miniatura también se valida", () => {
  // thumbMime sin thumbBytes entra en la rama: si no, se firmaría una
  // miniatura de tamaño desconocido.
  assert.equal(validateUploadRequest(photo({ thumbMime: "image/jpeg" })).code, "MEDIA_INVALID_THUMB");
  assert.equal(validateUploadRequest(photo({ thumbBytes: 1000 })).code, "MEDIA_INVALID_FORMAT");
});

// --- extensión --------------------------------------------------------------

test("extensionFor cubre todos los formatos del catálogo", () => {
  for (const mime of [...catalog.IMAGE_MIMES, ...catalog.VIDEO_MIMES]) {
    assert.notEqual(extensionFor(mime), "bin", `${mime} se guardaría como .bin`);
  }
});

test("extensionFor no distingue mayúsculas y tiene salida para lo desconocido", () => {
  assert.equal(extensionFor("IMAGE/JPEG"), "jpg");
  assert.equal(extensionFor("application/zip"), "bin");
  assert.equal(extensionFor(null), "bin");
  assert.equal(extensionFor(undefined), "bin");
});

// --- cupo de biblioteca del entrenador --------------------------------------

test("el cupo de biblioteca sube con el plan del profesional", () => {
  const quotaOf = (tier) => libraryBytesFor({ professionalPremium: { entitled: true, tier } });
  assert.ok(quotaOf("trainer_pro") < quotaOf("trainer_growth"));
  assert.ok(quotaOf("trainer_growth") < quotaOf("trainer_scale"));
});

test("sin plan activo se aplica el cupo gratuito", () => {
  const free = libraryBytesFor({});
  assert.equal(libraryBytesFor(null), free);
  assert.equal(libraryBytesFor({ professionalPremium: { entitled: false, tier: "trainer_scale" } }), free);
  // Un tier desconocido no abre la mano: cae al gratuito.
  assert.equal(libraryBytesFor({ professionalPremium: { entitled: true, tier: "inventado" } }), free);
  assert.ok(free < libraryBytesFor({ professionalPremium: { entitled: true, tier: "trainer_pro" } }));
});
