// En casa con mancuernas, 3 días: solo un par de mancuernas (mejor
// ajustables), una silla o banco y el suelo. Días alternos.

const WARMUP =
  "Calentamiento: 5 min de movilidad y saltos suaves (jumping jacks, rotaciones de cadera y hombros) y una serie del primer ejercicio con la mitad de peso.";

const ARMS_SUPERSET = {
  key: "brazos",
  type: "superset",
  name: "Superserie de brazos",
  rounds: 3,
  restBetweenExercises: 0,
  restBetweenRounds: 60,
  instructions: "Una serie de cada ejercicio seguidas y 60 s de descanso al terminar la ronda.",
};

module.exports = {
  name: "En casa con mancuernas · 3 días",
  workouts: [
    {
      name: "Día A",
      notes: WARMUP,
      blocks: [ARMS_SUPERSET],
      exercises: [
        { ex: "goblet_squat", sets: 4, reps: [10, 15], rir: 2, rest: 75, notes: "Si se queda ligero, baja en 3 segundos y haz una pausa abajo." },
        { ex: "flexiones", sets: 3, reps: [8, 15], rir: 2, rest: 75, notes: "Si no llegas a 8, apoya las rodillas." },
        { ex: "remo_mancuerna", sets: 3, reps: [10, 12], rir: 2, rest: 60, notes: "Repeticiones por brazo, con una mano apoyada en la silla." },
        { ex: "peso_muerto_rumano_mancuernas", sets: 3, reps: [10, 12], rir: 2, rest: 75 },
        { ex: "curl_mancuernas", reps: [12, 15], rir: 2, isolation: true, block: "brazos" },
        { ex: "patada_triceps_mancuerna", reps: [12, 15], rir: 2, isolation: true, block: "brazos" },
        { ex: "plancha", sets: 3, time: "0:40", rest: 45 },
      ],
    },
    {
      name: "Día B",
      notes: WARMUP,
      exercises: [
        { ex: "sentadilla_bulgara", sets: 3, reps: [10, 12], rir: 2, rest: 75, notes: "Repeticiones por pierna, con el pie de atrás sobre una silla." },
        { ex: "press_militar_mancuerna", sets: 3, reps: [10, 12], rir: 2, rest: 75 },
        { ex: "bend_over_row", sets: 3, reps: [10, 12], rir: 2, rest: 75, notes: "Tronco inclinado y espalda neutra; codos hacia la cadera." },
        { ex: "puente_gluteo", sets: 3, reps: [12, 15], rir: 2, rest: 60, notes: "Con una mancuerna sobre la cadera. Pausa arriba." },
        { ex: "elevaciones_laterales_mancuernas", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "crunch_invertido", sets: 3, reps: [12, 15], rir: 2, rest: 45, isolation: true },
      ],
    },
    {
      name: "Día C",
      notes: WARMUP,
      blocks: [ARMS_SUPERSET],
      exercises: [
        { ex: "zancadas", sets: 3, reps: [10, 12], rir: 2, rest: 75, notes: "Repeticiones por pierna, con una mancuerna en cada mano." },
        { ex: "press_mancuernas_plano", sets: 3, reps: [10, 12], rir: 2, rest: 75, notes: "En banco o tumbado en el suelo." },
        { ex: "pull_over_mancuerna", sets: 3, reps: [12, 15], rir: 2, rest: 60 },
        { ex: "hip_thrust_unilateral", sets: 3, reps: [12, 15], rir: 2, rest: 60, notes: "Repeticiones por pierna, con la espalda apoyada en el sofá." },
        { ex: "curl_martillo", reps: [12, 15], rir: 2, isolation: true, block: "brazos" },
        { ex: "extension_overhead_mancuerna", reps: [12, 15], rir: 2, isolation: true, block: "brazos" },
        { ex: "abdominales_bicicleta", sets: 3, reps: [20], rir: 2, rest: 45, notes: "Repeticiones totales, alternando lados." },
      ],
    },
  ],
};
