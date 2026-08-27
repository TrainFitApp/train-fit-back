// Movimiento 3 Coach Pro — registro de dolor.
//
// Espejo EXACTO de packages/shared-core/src/app/core/constants/pain.ts
// (frontend) — sincronizados a mano y comprobado por pain-catalog.test.js,
// igual que el catálogo de check-in y el de agujetas.
//
// POR QUÉ ES UN COMPONENTE APARTE Y NO UN CAMPO DE CHECK-IN
// Un check-in es semanal y una molestia va por días: "esta semana me dolió
// la rodilla" no dice si fue un día o siete, ni si va a más o a menos. Y
// sobre todo, el dolor es lo único de la app que puede obligar a cambiar el
// entrenamiento HOY.

// Lista CERRADA con lateralidad ya incluida, mismo criterio que el catálogo
// de agujetas: una serie temporal necesita que el eje no cambie, y "rodilla"
// sin lado no sirve para seguir una lesión.
const PAIN_ZONES = [
  "Cuello",
  "Espalda alta",
  "Espalda baja",
  "Hombro izq.",
  "Hombro der.",
  "Codo izq.",
  "Codo der.",
  "Muñeca izq.",
  "Muñeca der.",
  "Cadera izq.",
  "Cadera der.",
  "Rodilla izq.",
  "Rodilla der.",
  "Tobillo izq.",
  "Tobillo der.",
];

// EVA 0-10, la escala que se usa en consulta. Las frases van por TRAMOS y no
// una por número: nadie distingue de verdad un 6 de un 7, y prometer esa
// precisión haría que el cliente se lo pensara demasiado y acabara
// contestando cualquier cosa. Lo que sí importa es el salto entre tramos,
// que es donde cambia lo que el entrenador tiene que hacer.
const PAIN_BANDS = [
  { from: 0, to: 0, label: "Sin dolor" },
  { from: 1, to: 2, label: "Molestia leve, apenas la noto" },
  { from: 3, to: 4, label: "Dolor leve: me distrae, pero hago vida normal" },
  { from: 5, to: 6, label: "Dolor moderado: me limita algunos movimientos" },
  { from: 7, to: 8, label: "Dolor fuerte: no puedo entrenar esa zona" },
  { from: 9, to: 10, label: "Dolor insoportable: tengo que parar del todo" },
];

const PAIN_MIN = 0;
const PAIN_MAX = 10;

// A partir de aquí el dolor deja de ser una molestia y pasa a condicionar el
// entrenamiento. Es el umbral que dispara el aviso al entrenador — el mismo
// número que separa el tramo "me limita algunos movimientos" del anterior.
const PAIN_LIMITING_LEVEL = 5;

const PAIN_ZONE_SET = new Set(PAIN_ZONES);

function bandFor(level) {
  return PAIN_BANDS.find((band) => level >= band.from && level <= band.to) || null;
}

function isValidLevel(level) {
  return Number.isInteger(level) && level >= PAIN_MIN && level <= PAIN_MAX;
}

/**
 * Convierte a nivel, o devuelve null.
 *
 * El descarte de "sin valor" va ANTES de convertir a propósito: Number(null)
 * y Number("") son 0, y 0 es un nivel VÁLIDO en esta escala ("hoy no me
 * duele"). Sin esta comprobación, un nivel que no llegó se guardaría como
 * "no le duele nada" — que es justo lo contrario de "no lo sé", y encima
 * cerraría el aviso al entrenador. Mismo cuidado que toFiniteOrNull en
 * workouts/workout-controller.js.
 */
function toLevelOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const level = Number(value);
  return isValidLevel(level) ? level : null;
}

function isValidZone(zone) {
  return PAIN_ZONE_SET.has(zone);
}

/**
 * Deja una entrada del registro diario en la forma que guarda el esquema, o
 * devuelve null si no es utilizable.
 *
 * A diferencia de las agujetas, el nivel 0 SÍ se guarda: "hoy no me duele"
 * es información en una zona que viene doliendo, y es lo que permite ver que
 * una lesión se está cerrando. Lo que no se guarda es una zona que nadie ha
 * tocado nunca — esa simplemente no aparece.
 */
function sanitizePainEntry(entry) {
  if (!entry || !isValidZone(entry.zone)) return null;

  const level = toLevelOrNull(entry.level);
  if (level === null) return null;

  return {
    zone: entry.zone,
    level,
    note: String(entry.note || "").trim().slice(0, 300),
  };
}

/**
 * Umbrales de una zona: hasta dónde se puede trabajar y a partir de dónde
 * hay que parar. Los fija EL ENTRENADOR, no el cliente.
 *
 * work <= pain siempre: si el umbral de trabajo fuera mayor que el de dolor,
 * la pauta diría "sigue" y "para" a la vez. Se corrige en vez de rechazar —
 * quien lo escribió quiso decir dos números, no romper el guardado.
 */
function sanitizeThreshold(threshold) {
  if (!threshold || !isValidZone(threshold.zone)) return null;

  const work = toLevelOrNull(threshold.workLevel);
  const pain = toLevelOrNull(threshold.painLevel);
  if (work === null || pain === null) return null;

  return {
    zone: threshold.zone,
    workLevel: Math.min(work, pain),
    painLevel: Math.max(work, pain),
    note: String(threshold.note || "").trim().slice(0, 300),
  };
}

module.exports = {
  PAIN_ZONES,
  PAIN_BANDS,
  PAIN_MIN,
  PAIN_MAX,
  PAIN_LIMITING_LEVEL,
  bandFor,
  isValidLevel,
  isValidZone,
  toLevelOrNull,
  sanitizePainEntry,
  sanitizeThreshold,
};
