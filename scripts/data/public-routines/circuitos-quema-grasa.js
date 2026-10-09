// Circuitos de 3 días para perder grasa sin perder músculo: calentamiento
// en máquina de cardio, dos circuitos de fuerza de cuerpo entero y cardio
// suave al final. Días alternos; el resto de días, 8.000-10.000 pasos.

const WARMUP_NOTE =
  "Haz cada circuito seguido, descansando solo lo indicado entre ejercicios, y descansa 90 s al terminar cada ronda. Cargas que te dejen 2 repeticiones en reserva.";

const circuit = (key, name) => ({
  key,
  type: "circuit",
  name,
  rounds: 3,
  restBetweenExercises: 15,
  restBetweenRounds: 90,
  instructions: "Ejercicios seguidos con 15 s para cambiar de uno a otro; 90 s de descanso al acabar cada ronda.",
});

const WARMUP_BLOCK = {
  key: "calentamiento",
  type: "warmup",
  name: "Calentamiento",
  rounds: 1,
  instructions: "Ritmo suave, que puedas hablar sin esfuerzo.",
};

const FINISHER_BLOCK = {
  key: "final",
  type: "finisher",
  name: "Cardio final",
  rounds: 1,
  instructions: "Cardio suave y constante (zona 2): puedes hablar en frases cortas.",
};

const BLOCKS = [WARMUP_BLOCK, circuit("circuito_a", "Circuito A"), circuit("circuito_b", "Circuito B"), FINISHER_BLOCK];

module.exports = {
  name: "Circuitos quema grasa · 3 días",
  workouts: [
    {
      name: "Circuitos 1",
      notes: WARMUP_NOTE,
      blocks: BLOCKS,
      exercises: [
        { ex: "eliptica", time: "5:00", block: "calentamiento" },
        { ex: "goblet_squat", reps: [12, 15], rir: 2, block: "circuito_a" },
        { ex: "flexiones", reps: [10, 15], rir: 2, block: "circuito_a", notes: "Con las rodillas apoyadas si hace falta." },
        { ex: "remo_mancuerna", reps: [12], rir: 2, block: "circuito_a", notes: "Repeticiones por brazo." },
        { ex: "mountain_climbers", time: "0:30", block: "circuito_a" },
        { ex: "zancadas", reps: [10, 12], rir: 2, block: "circuito_b", notes: "Repeticiones por pierna." },
        { ex: "press_militar_mancuerna", reps: [12, 15], rir: 2, block: "circuito_b" },
        { ex: "puente_gluteo", reps: [15], rir: 2, block: "circuito_b" },
        { ex: "plancha", time: "0:30", block: "circuito_b" },
        { ex: "cinta", time: "15:00", block: "final", notes: "Caminata en inclinación (8-12 %) a 5-6 km/h." },
      ],
    },
    {
      name: "Circuitos 2",
      notes: WARMUP_NOTE,
      blocks: BLOCKS,
      exercises: [
        { ex: "remo_ergometro", time: "5:00", block: "calentamiento" },
        { ex: "peso_muerto_rumano_mancuernas", reps: [12], rir: 2, block: "circuito_a" },
        { ex: "jalon_neutro", reps: [12, 15], rir: 2, block: "circuito_a" },
        { ex: "step_ups", reps: [10, 12], rir: 2, block: "circuito_a", notes: "Repeticiones por pierna, en un cajón o banco a la altura de la rodilla." },
        { ex: "jumping_jacks", reps: [30, 40], block: "circuito_a" },
        { ex: "press_inclinado_mancuernas", reps: [12, 15], rir: 2, block: "circuito_b" },
        { ex: "remo_polea_baja", reps: [12, 15], rir: 2, block: "circuito_b" },
        { ex: "crunch_invertido", reps: [15], rir: 2, block: "circuito_b" },
        { ex: "comba", time: "1:00", block: "circuito_b" },
        { ex: "bici_estatica", time: "15:00", block: "final" },
      ],
    },
    {
      name: "Circuitos 3",
      notes: WARMUP_NOTE,
      blocks: BLOCKS,
      exercises: [
        { ex: "bici_estatica", time: "5:00", block: "calentamiento" },
        { ex: "sentadillas_salto", reps: [10, 12], block: "circuito_a", notes: "Aterriza suave, con las rodillas alineadas." },
        { ex: "flexiones", reps: [10, 15], rir: 2, block: "circuito_a" },
        { ex: "bend_over_row", reps: [12], rir: 2, block: "circuito_a" },
        { ex: "burpees", reps: [8, 10], block: "circuito_a" },
        { ex: "zancadas", reps: [10, 12], rir: 2, block: "circuito_b", notes: "Repeticiones por pierna." },
        { ex: "elevaciones_laterales_mancuernas", reps: [15], rir: 2, isolation: true, block: "circuito_b" },
        { ex: "abdominales_bicicleta", reps: [20], block: "circuito_b", notes: "Repeticiones totales, alternando lados." },
        { ex: "skipping", time: "0:30", block: "circuito_b" },
        { ex: "eliptica", time: "15:00", block: "final" },
      ],
    },
  ],
};
