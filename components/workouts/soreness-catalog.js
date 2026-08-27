// Movimiento 2 Coach Pro — agujetas por grupo muscular.
//
// Espejo EXACTO de packages/shared-core/src/app/core/constants/soreness.ts
// (frontend) — mantenidos sincronizados a mano, igual que el catálogo de
// campos de check-in, y comprobado por soreness-catalog.test.js.
//
// POR QUÉ SE PREGUNTA AL EMPEZAR Y NO AL TERMINAR
// Las agujetas aparecen 24-72 h DESPUÉS del esfuerzo, así que preguntarlas
// al acabar la sesión mide la fatiga del momento, no las agujetas: para
// cuando duelen de verdad, el cliente ya cerró la app. Preguntadas al
// empezar, la respuesta habla de las sesiones ANTERIORES — que es justo lo
// que el entrenador necesita para decidir si toca insistir o aflojar. Por
// eso el campo se llama `sorenessPre` y viaja junto a `readinessPre`, en el
// aviso que ya existía antes de empezar (no se añade un segundo).

// Lista CERRADA, no derivada de los grupos musculares de los ejercicios:
// aquéllos son datos de catálogo con variantes creadas por usuarios y
// erratas de la semilla ("Deltoides poterior"), y una serie temporal
// necesita que el eje no cambie. Los nombres son los canónicos que ya usa
// es-en-db.map.ts, así que TranslateDbPipe los traduce sin añadir nada.
const SORENESS_MUSCLES = [
  "Pectoral",
  "Espalda alta",
  "Espalda baja",
  "Deltoides anterior",
  "Deltoides lateral",
  "Deltoides posterior",
  "Bíceps",
  "Tríceps",
  "Antebrazo",
  "Abdomen",
  "Oblicuos",
  "Glúteo",
  "Cuádriceps",
  "Femoral",
  "Aductor",
  "Gemelo",
];

// Mismo criterio que las anclas de los check-ins: un 3 sin frase no es un
// dato. Aquí importa especialmente el salto del 3 al 4, que es donde la
// molestia pasa a condicionar el entrenamiento.
const SORENESS_ANCHORS = [
  "Nada, no lo noto",
  "Se nota al tocarlo o al estirar",
  "Molesta al moverme, pero no me limita",
  "Duele y me limita el rango o la fuerza",
  "Muy dolorido, hoy no podría entrenarlo",
];

const SORENESS_MUSCLE_SET = new Set(SORENESS_MUSCLES);

/**
 * Deja el array en la forma que guarda el esquema, descartando lo que no
 * encaje en vez de rechazar la petición entera: esto viaja dentro del mismo
 * `modifyWorkout` que arranca la sesión, y un músculo desconocido no puede
 * impedir que alguien empiece a entrenar.
 *
 * - Solo músculos del catálogo.
 * - Solo niveles enteros de 1 a SORENESS_ANCHORS.length.
 * - Se descarta el nivel 1 ("nada"): guardar "no me duele" de los 16 grupos
 *   en cada sesión es ruido; la ausencia ya dice eso mismo.
 * - Un músculo repetido se queda con su ÚLTIMO valor, no con dos filas.
 */
function sanitizeSoreness(entries) {
  const maxLevel = SORENESS_ANCHORS.length;
  const byMuscle = new Map();

  for (const entry of Array.isArray(entries) ? entries : []) {
    const muscle = entry?.muscle;
    if (!SORENESS_MUSCLE_SET.has(muscle)) continue;

    const level = Number(entry?.level);
    if (!Number.isInteger(level) || level < 1 || level > maxLevel) continue;
    if (level === 1) continue;

    byMuscle.set(muscle, level);
  }

  // Orden del catálogo, no el de llegada: así el entrenador lee siempre los
  // grupos en el mismo sitio, sesión tras sesión.
  return SORENESS_MUSCLES.filter((muscle) => byMuscle.has(muscle)).map((muscle) => ({
    muscle,
    level: byMuscle.get(muscle),
  }));
}

module.exports = {
  SORENESS_MUSCLES,
  SORENESS_ANCHORS,
  sanitizeSoreness,
};
