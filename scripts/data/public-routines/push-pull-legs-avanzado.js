// Push / Pull / Legs de 6 días para avanzados: cada grupo dos veces por
// semana, un día con básicos pesados (5-8) y otro con más volumen. De lunes
// a sábado, domingo libre.

const WARMUP =
  "Calentamiento: 5-8 min de cardio suave, movilidad específica y 3 series de aproximación del primer ejercicio subiendo la carga.";

module.exports = {
  name: "Push Pull Legs · 6 días · Avanzado",
  workouts: [
    {
      name: "Push A · Pecho",
      notes: WARMUP,
      exercises: [
        { ex: "press_banca", sets: 4, reps: [5, 7], rir: 2, rest: 180, notes: "Retracción escapular y arco natural. Bajada controlada." },
        { ex: "press_inclinado_mancuernas", sets: 3, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "press_militar_mancuerna", sets: 3, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "cruce_poleas_ascendente", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "elevaciones_laterales_polea", sets: 4, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "extension_triceps_cuerda", sets: 3, reps: [10, 12], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Pull A · Dorsal",
      notes: WARMUP,
      exercises: [
        { ex: "dominadas", sets: 4, reps: [6, 8], rir: 2, rest: 150, notes: "Lastre cuando completes 4×8 con buena técnica." },
        { ex: "remo_pendlay", sets: 4, reps: [6, 8], rir: 2, rest: 150, notes: "Cada repetición sale del suelo; tronco paralelo al suelo." },
        { ex: "jalon_neutro", sets: 3, reps: [10, 12], rir: 2, rest: 90 },
        { ex: "facepull", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "curl_barra_z", sets: 3, reps: [8, 10], rir: 2, rest: 75, isolation: true },
        { ex: "curl_martillo", sets: 3, reps: [10, 12], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Legs A · Cuádriceps",
      notes: WARMUP,
      exercises: [
        { ex: "sentadilla_barra_alta", sets: 4, reps: [5, 7], rir: 2, rest: 180 },
        { ex: "peso_muerto_rumano", sets: 3, reps: [8, 10], rir: 2, rest: 150 },
        { ex: "prensa_45", sets: 3, reps: [10, 12], rir: 2, rest: 120 },
        { ex: "extension_cuadriceps", sets: 3, reps: [12, 15], rir: 2, rest: 75, isolation: true },
        { ex: "curl_femoral_sentado", sets: 3, reps: [10, 12], rir: 2, rest: 75, isolation: true },
        { ex: "gemelo_maquina_pie", sets: 4, reps: [10, 12], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Push B · Hombro",
      notes: WARMUP,
      exercises: [
        { ex: "press_militar_barra", sets: 4, reps: [6, 8], rir: 2, rest: 150 },
        { ex: "press_inclinado_multipower", sets: 3, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "fondos_paralelas", sets: 3, reps: [8, 12], rir: 2, rest: 120, notes: "Tronco ligeramente inclinado hacia delante. Lastre cuando pases de 12." },
        { ex: "aperturas_maquina", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "elevaciones_laterales_mancuernas", sets: 4, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "press_frances_barra_z", sets: 3, reps: [10, 12], rir: 2, rest: 75, isolation: true },
      ],
    },
    {
      name: "Pull B · Espalda media",
      notes: WARMUP,
      exercises: [
        { ex: "peso_muerto", sets: 3, reps: [4, 6], rir: 2, rest: 180, notes: "Espalda neutra; si la técnica se rompe, termina la serie." },
        { ex: "jalon_supino", sets: 3, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "remo_t", sets: 3, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "pajaros_maquina", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "curl_inclinado", sets: 3, reps: [10, 12], rir: 2, rest: 60, isolation: true },
        { ex: "curl_bayesian", sets: 2, reps: [12, 15], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Legs B · Glúteo y femoral",
      notes: WARMUP,
      exercises: [
        { ex: "hip_thrust", sets: 4, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "sentadilla_hack", sets: 3, reps: [8, 10], rir: 2, rest: 150 },
        { ex: "sentadilla_bulgara", sets: 3, reps: [10, 12], rir: 2, rest: 90, notes: "Repeticiones por pierna." },
        { ex: "curl_femoral_tumbado", sets: 3, reps: [10, 12], rir: 2, rest: 75, isolation: true },
        { ex: "abductores_maquina", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "gemelo_sentado", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "crunch_polea", sets: 3, reps: [10, 15], rir: 2, rest: 60, isolation: true },
      ],
    },
  ],
};
