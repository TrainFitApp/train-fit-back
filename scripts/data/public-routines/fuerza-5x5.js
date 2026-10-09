// Fuerza 5×5 de 3 días: los cuatro básicos con progresión lineal de carga y
// lo justo de accesorios. Días alternos (lunes, miércoles y viernes).

const WARMUP =
  "Calentamiento: 5 min de cardio suave y series de aproximación del primer básico (barra sola ×10, 50 % ×5, 70 % ×3, 85 % ×1). Sube 2,5 kg (1 kg en press militar) cada sesión en la que completes todas las repeticiones.";

module.exports = {
  name: "Fuerza 5×5 · 3 días",
  workouts: [
    {
      name: "Día 1 · Sentadilla y banca",
      notes: WARMUP,
      exercises: [
        { ex: "sentadilla_barra_alta", sets: 5, reps: [5], rir: 3, rest: 180 },
        { ex: "press_banca", sets: 5, reps: [5], rir: 3, rest: 180 },
        { ex: "remo_pendlay", sets: 5, reps: [5], rir: 3, rest: 150 },
        { ex: "plancha", sets: 3, time: "0:45", rest: 60 },
      ],
    },
    {
      name: "Día 2 · Sentadilla y militar",
      notes: WARMUP,
      exercises: [
        { ex: "sentadilla_barra_alta", sets: 5, reps: [5], rir: 3, rest: 180 },
        { ex: "press_militar_barra", sets: 5, reps: [5], rir: 3, rest: 180 },
        { ex: "peso_muerto", sets: 3, reps: [5], rir: 3, rest: 180, notes: "Cada repetición empieza desde el suelo, sin rebote." },
        { ex: "dominadas", sets: 3, reps: [6, 8], rir: 2, rest: 120, notes: "Con asistencia si no llegas a 6." },
      ],
    },
    {
      name: "Día 3 · Sentadilla y accesorios",
      notes: WARMUP,
      exercises: [
        { ex: "sentadilla_barra_alta", sets: 5, reps: [5], rir: 3, rest: 180, notes: "Misma carga que el día 2: hoy busca la mejor técnica." },
        { ex: "press_banca_agarre_cerrado", sets: 3, reps: [6, 8], rir: 2, rest: 150 },
        { ex: "remo_45", sets: 3, reps: [6, 8], rir: 2, rest: 150 },
        { ex: "peso_muerto_rumano", sets: 3, reps: [8], rir: 3, rest: 150 },
        { ex: "rueda_abdominal", sets: 3, reps: [8, 10], rir: 2, rest: 60 },
      ],
    },
  ],
};
