const test = require("node:test");
const assert = require("node:assert/strict");
const {
  INTAKE_MEASUREMENT_KEYS,
  INTAKE_PHOTO_POSES,
  MAX_INTAKE_VIDEOS,
  normalizeMeasurementRequests,
  normalizePhotoRequest,
  normalizeVideoRequests,
  intakeFormOf,
  buildIntakeMeasurements,
  anthropometryFieldsOf,
  intakePhotosError,
  buildIntakeVideos,
} = require("./intake-requests");
const { CHECKIN_FIELDS_BY_KEY } = require("../trainerCheckins/checkin-field-catalog");
const { INTAKE_FIELD_KEYS } = require("./intake-field-catalog");
const { MEASUREMENT_FIELDS } = require("../anthropometry/anthropometry-origin");

// Lo que el profesional pide en el alta (medidas, fotos, vídeos) es la
// primera foto de la evolución del cliente: todo lo que se compare después
// parte de aquí. Una medida imposible o una petición mal formada no puede
// colarse.

const ID_A = "507f1f77bcf86cd799439011";
const ID_B = "507f1f77bcf86cd799439012";

test("catálogo de medidas pedibles", async (t) => {
  await t.test("son las de composición y perímetros del catálogo de check-in, sin el peso", () => {
    assert.ok(INTAKE_MEASUREMENT_KEYS.length > 0);
    assert.ok(!INTAKE_MEASUREMENT_KEYS.includes("weight"), "el peso se pide siempre en el perfil");
    for (const key of INTAKE_MEASUREMENT_KEYS) {
      const field = CHECKIN_FIELDS_BY_KEY.get(key);
      assert.equal(field.storage, "anthropometry", key);
      assert.equal(field.type, "number", key);
      assert.ok(MEASUREMENT_FIELDS.includes(field.anthropometryField), `${key} no tiene sitio en Anthropometry`);
      assert.ok(field.min !== undefined && field.max !== undefined, `${key} sin cotas de plausibilidad`);
    }
  });

  await t.test("las fotos de inicio son frente, perfil y espalda", () => {
    assert.deepEqual(INTAKE_PHOTO_POSES, ["front", "side", "back"]);
  });
});

test("configuración: medidas pedidas", async (t) => {
  await t.test("sin medidas, lista vacía", () => {
    assert.deepEqual(normalizeMeasurementRequests(undefined), { value: [] });
    assert.deepEqual(normalizeMeasurementRequests(null), { value: [] });
  });

  await t.test("en el orden del catálogo, sin repetir y con required booleano estricto", () => {
    const { value } = normalizeMeasurementRequests([
      { key: "perimeter_hip", required: "true" },
      { key: "perimeter_waist", required: true },
      { key: "perimeter_hip", required: true },
    ]);
    assert.deepEqual(value, [
      { key: "perimeter_waist", required: true },
      { key: "perimeter_hip", required: true },
    ]);
  });

  await t.test("rechaza claves fuera del catálogo, el peso y lo que no es una lista", () => {
    assert.ok(normalizeMeasurementRequests([{ key: "inventada" }]).error);
    assert.ok(normalizeMeasurementRequests([{ key: "weight" }]).error);
    assert.ok(normalizeMeasurementRequests([{ key: "stress_level" }]).error, "solo medidas, no bienestar");
    assert.ok(normalizeMeasurementRequests({ key: "perimeter_waist" }).error);
    assert.ok(normalizeMeasurementRequests([null]).error);
  });
});

test("configuración: fotos pedidas", async (t) => {
  await t.test("null o false: no se piden", () => {
    assert.deepEqual(normalizePhotoRequest(null), { value: null });
    assert.deepEqual(normalizePhotoRequest(false), { value: null });
  });

  await t.test("sin poses: las tres; con poses, en orden y sin repetir", () => {
    assert.deepEqual(normalizePhotoRequest({ required: true }), { value: { poses: ["front", "side", "back"], required: true } });
    assert.deepEqual(normalizePhotoRequest({ poses: ["back", "front", "back"] }), { value: { poses: ["front", "back"], required: false } });
  });

  await t.test("rechaza la pose libre, poses vacías y formas raras", () => {
    assert.ok(normalizePhotoRequest({ poses: ["extra"] }).error);
    assert.ok(normalizePhotoRequest({ poses: [] }).error);
    assert.ok(normalizePhotoRequest(["front"]).error);
    assert.ok(normalizePhotoRequest("front").error);
  });
});

test("configuración: vídeos pedidos", async (t) => {
  await t.test("conserva el _id válido, recorta el texto y activa por defecto", () => {
    const { value } = normalizeVideoRequests([
      { _id: ID_A, label: "  Sentadilla sin peso, de perfil  ", required: true },
      { _id: "temporal-1", label: "Postura de pie", enabled: false },
    ]);
    assert.deepEqual(value, [
      { _id: ID_A, label: "Sentadilla sin peso, de perfil", required: true, enabled: true },
      { label: "Postura de pie", required: false, enabled: false },
    ]);
  });

  await t.test("cada vídeo necesita qué grabar, con un límite de longitud y de cantidad", () => {
    assert.ok(normalizeVideoRequests([{ label: "   " }]).error);
    assert.ok(normalizeVideoRequests([{ label: "x".repeat(201) }]).error);
    const many = Array.from({ length: MAX_INTAKE_VIDEOS + 1 }, (_, i) => ({ label: `Vídeo ${i}` }));
    assert.ok(normalizeVideoRequests(many).error);
    assert.ok(normalizeVideoRequests("Sentadilla").error);
  });
});

test("formulario de cada cliente: la copia de lo activo al invitar", async (t) => {
  await t.test("sin configuración: todos los campos y nada más", () => {
    assert.deepEqual(intakeFormOf(null), {
      enabledFields: INTAKE_FIELD_KEYS,
      customQuestions: [],
      measurements: [],
      photos: null,
      videos: [],
    });
  });

  await t.test("copia solo lo activo, con sus _id, y sin la marca de activo", () => {
    const config = {
      enabledFields: ["goals"],
      customQuestions: [
        { _id: ID_A, label: "¿Turnos?", type: "select", unit: "", options: ["Mañana", "Tarde"], required: true, enabled: true },
        { _id: ID_B, label: "Vieja", type: "text", required: false, enabled: false },
      ],
      measurements: [{ key: "perimeter_waist", required: true }, { key: "perimeter_hip" }],
      photos: { poses: ["front", "back"], required: true },
      videos: [
        { _id: ID_A, label: "Sentadilla de perfil", required: true, enabled: true },
        { _id: ID_B, label: "Ya no", required: true, enabled: false },
      ],
      lastScopes: ["training"],
    };
    assert.deepEqual(intakeFormOf(config), {
      enabledFields: ["goals"],
      customQuestions: [{ _id: ID_A, label: "¿Turnos?", type: "select", unit: "", options: ["Mañana", "Tarde"], required: true }],
      measurements: [
        { key: "perimeter_waist", required: true },
        { key: "perimeter_hip", required: false },
      ],
      photos: { poses: ["front", "back"], required: true },
      videos: [{ _id: ID_A, label: "Sentadilla de perfil", required: true }],
    });
  });

  await t.test("es una copia: cambiar después la configuración no cambia el formulario", () => {
    const config = { enabledFields: ["goals"], customQuestions: [], measurements: [], photos: { poses: ["front"], required: false }, videos: [] };
    const form = intakeFormOf(config);
    config.enabledFields.push("equipment");
    config.photos.poses.push("side");
    assert.deepEqual(form.enabledFields, ["goals"]);
    assert.deepEqual(form.photos.poses, ["front"]);
  });
});

test("respuesta: medidas del cliente", async (t) => {
  const requests = [
    { key: "perimeter_waist", required: true },
    { key: "perimeter_hip", required: false },
  ];

  await t.test("guarda las pedidas, normaliza números en texto e ignora lo que no se pidió", () => {
    const result = buildIntakeMeasurements(requests, [
      { key: "perimeter_waist", value: "82,5" },
      { key: "perimeter_hip", value: 98 },
      { key: "perimeter_neck", value: 38 },
    ]);
    assert.deepEqual(result, {
      measurements: [
        { key: "perimeter_waist", value: 82.5 },
        { key: "perimeter_hip", value: 98 },
      ],
    });
  });

  await t.test("la obligatoria tiene que llegar; la opcional puede faltar", () => {
    assert.match(buildIntakeMeasurements(requests, [{ key: "perimeter_hip", value: 98 }]).error, /Cintura/);
    assert.deepEqual(buildIntakeMeasurements(requests, [{ key: "perimeter_waist", value: 80 }]).measurements, [
      { key: "perimeter_waist", value: 80 },
    ]);
    assert.match(buildIntakeMeasurements(requests, [{ key: "perimeter_waist", value: "" }]).error, /Falta/);
  });

  await t.test("un valor imposible se rechaza con las mismas cotas que los check-ins", () => {
    assert.match(buildIntakeMeasurements(requests, [{ key: "perimeter_waist", value: 800 }]).error, /Revisa/);
    assert.match(buildIntakeMeasurements(requests, [{ key: "perimeter_waist", value: "ochenta" }]).error, /Revisa/);
    assert.match(buildIntakeMeasurements(requests, [{ key: "perimeter_waist", value: 80 }, { key: "perimeter_hip", value: 5 }]).error, /Cadera/);
  });

  await t.test("sin peticiones no se guarda nada aunque lleguen medidas", () => {
    assert.deepEqual(buildIntakeMeasurements([], [{ key: "perimeter_waist", value: 80 }]), { measurements: [] });
    assert.deepEqual(buildIntakeMeasurements(undefined, undefined), { measurements: [] });
  });

  await t.test("se traducen a los campos de Anthropometry", () => {
    assert.deepEqual(
      anthropometryFieldsOf([
        { key: "perimeter_waist", value: 80 },
        { key: "perimeter_navel", value: 85 },
        { key: "fat_mass", value: 14.2 },
      ]),
      { waist: 80, abdomen: 85, fatMass: 14.2 }
    );
  });
});

test("respuesta: fotos del cliente", async (t) => {
  const day = (poses) => ({ photos: poses.map((pose) => ({ pose })) });

  await t.test("obligatorias: todas las poses pedidas", () => {
    const request = { poses: ["front", "side", "back"], required: true };
    assert.equal(intakePhotosError(request, day(["front", "side", "back"])), null);
    assert.match(intakePhotosError(request, day(["front"])), /perfil, espalda/);
    assert.match(intakePhotosError(request, null), /frente, perfil, espalda/);
  });

  await t.test("solo cuentan las poses pedidas", () => {
    assert.equal(intakePhotosError({ poses: ["front"], required: true }, day(["front"])), null);
  });

  await t.test("opcionales o no pedidas: nunca bloquean", () => {
    assert.equal(intakePhotosError({ poses: ["front", "side"], required: false }, null), null);
    assert.equal(intakePhotosError(null, null), null);
  });
});

test("respuesta: vídeos del cliente", async (t) => {
  const requests = [
    { _id: ID_A, label: "Sentadilla de perfil", required: true, enabled: true },
    { _id: ID_B, label: "Postura de frente", required: false, enabled: true },
    { _id: "507f1f77bcf86cd799439013", label: "Desactivado", required: true, enabled: false },
  ];
  const usable = new Set(["v1", "v2"]);

  await t.test("uno por petición, con la indicación copiada", () => {
    const result = buildIntakeVideos(requests, [
      { requestId: ID_A, assetId: "v1" },
      { requestId: ID_B, assetId: "v2" },
    ], usable);
    assert.deepEqual(result.videos, [
      { requestId: ID_A, label: "Sentadilla de perfil", assetId: "v1" },
      { requestId: ID_B, label: "Postura de frente", assetId: "v2" },
    ]);
  });

  await t.test("el obligatorio tiene que llegar; los desactivados no se piden", () => {
    assert.match(buildIntakeVideos(requests, [{ requestId: ID_B, assetId: "v2" }], usable).error, /Sentadilla/);
    assert.deepEqual(buildIntakeVideos(requests, [{ requestId: ID_A, assetId: "v1" }], usable).videos.length, 1);
  });

  await t.test("un vídeo que no es suyo, no está subido o se repite no vale", () => {
    assert.match(buildIntakeVideos(requests, [{ requestId: ID_A, assetId: "ajeno" }], usable).error, /Vuelve a subir/);
    assert.match(
      buildIntakeVideos(requests, [{ requestId: ID_A, assetId: "v1" }, { requestId: ID_B, assetId: "v1" }], usable).error,
      /propia grabación/
    );
  });

  await t.test("lo que no responde a una petición se ignora", () => {
    const result = buildIntakeVideos(requests, [{ requestId: ID_A, assetId: "v1" }, { requestId: "otra", assetId: "v2" }], usable);
    assert.deepEqual(result.videos.map((video) => video.assetId), ["v1"]);
  });
});
