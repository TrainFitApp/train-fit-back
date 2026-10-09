// Weider de 5 días: un grupo muscular por sesión con mucho volumen por
// grupo. Para quien entrena de lunes a viernes y recupera bien; el brazo va
// en superseries para no alargar la sesión.

const WARMUP =
  "Calentamiento: 5-8 min de cardio suave y 2-3 series de aproximación del primer ejercicio.";

const armsSuperset = (key, name) => ({
  key,
  type: "superset",
  name,
  rounds: 3,
  restBetweenExercises: 0,
  restBetweenRounds: 90,
  instructions: "Bíceps y tríceps seguidos, sin descanso entre ellos; 90 s al terminar la ronda.",
});

module.exports = {
  name: "Weider · 5 días · Hipertrofia",
  workouts: [
    {
      name: "Pecho",
      notes: WARMUP,
      exercises: [
        { ex: "press_banca", sets: 4, reps: [6, 8], rir: 3, rest: 150 },
        { ex: "press_inclinado_mancuernas", sets: 4, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "fondos_paralelas", sets: 3, reps: [8, 12], rir: 2, rest: 120 },
        { ex: "aperturas_maquina", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "cruce_poleas_ascendente", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Espalda",
      notes: WARMUP,
      exercises: [
        { ex: "dominadas", sets: 4, reps: [6, 10], rir: 2, rest: 150, notes: "Con asistencia si no llegas a 6." },
        { ex: "remo_45", sets: 4, reps: [8, 10], rir: 3, rest: 120 },
        { ex: "jalon_neutro", sets: 3, reps: [10, 12], rir: 2, rest: 90 },
        { ex: "remo_gironda", sets: 3, reps: [10, 12], rir: 2, rest: 90 },
        { ex: "pull_over_polea", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true, notes: "Brazos casi rectos; el movimiento sale del hombro." },
        { ex: "hiperextension_lumbar", sets: 3, reps: [12, 15], rir: 3, rest: 60 },
      ],
    },
    {
      name: "Pierna",
      notes: WARMUP,
      exercises: [
        { ex: "sentadilla_barra_alta", sets: 4, reps: [6, 8], rir: 3, rest: 180 },
        { ex: "prensa_45", sets: 3, reps: [10, 12], rir: 2, rest: 120 },
        { ex: "peso_muerto_rumano", sets: 3, reps: [8, 10], rir: 3, rest: 150 },
        { ex: "extension_cuadriceps", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "curl_femoral_tumbado", sets: 3, reps: [10, 12], rir: 2, rest: 60, isolation: true },
        { ex: "gemelo_maquina_pie", sets: 4, reps: [10, 15], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Hombro",
      notes: WARMUP,
      exercises: [
        { ex: "press_militar_mancuerna", sets: 4, reps: [8, 10], rir: 3, rest: 120 },
        { ex: "elevaciones_laterales_mancuernas", sets: 4, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "elevaciones_laterales_polea", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true, notes: "Repeticiones por brazo." },
        { ex: "pajaros_mancuernas_inclinado", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "facepull", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "encogimientos", sets: 3, reps: [10, 12], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Brazo y abdomen",
      notes: WARMUP,
      blocks: [armsSuperset("brazos_1", "Superserie 1"), armsSuperset("brazos_2", "Superserie 2"), armsSuperset("brazos_3", "Superserie 3")],
      exercises: [
        { ex: "curl_barra_z", reps: [8, 10], rir: 2, isolation: true, block: "brazos_1" },
        { ex: "press_frances_barra_z", reps: [8, 10], rir: 2, isolation: true, block: "brazos_1" },
        { ex: "curl_inclinado", reps: [10, 12], rir: 2, isolation: true, block: "brazos_2" },
        { ex: "extension_triceps_cuerda", reps: [10, 12], rir: 2, isolation: true, block: "brazos_2" },
        { ex: "curl_martillo", reps: [10, 12], rir: 2, isolation: true, block: "brazos_3" },
        { ex: "extension_overhead_cuerda", reps: [12, 15], rir: 2, isolation: true, block: "brazos_3" },
        { ex: "crunch_polea", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
      ],
    },
  ],
};
