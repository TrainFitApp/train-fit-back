// Torso / Pierna de 4 días para quien ya domina los básicos: dos sesiones de
// cada, una de fuerza-hipertrofia (6-8) y otra de más volumen (8-12), con
// superseries de brazos al final de los torsos. Lunes, martes, jueves y
// viernes.

const WARMUP =
  "Calentamiento: 5-8 min de cardio suave, movilidad de hombros y caderas y 2-3 series de aproximación del primer ejercicio.";

const ARMS_SUPERSET = {
  key: "brazos",
  type: "superset",
  name: "Superserie de brazos",
  rounds: 3,
  restBetweenExercises: 0,
  restBetweenRounds: 90,
  instructions: "Haz una serie de cada ejercicio sin descanso y descansa 90 s al terminar la ronda.",
};

module.exports = {
  name: "Torso / Pierna · 4 días · Intermedio",
  workouts: [
    {
      name: "Torso A · Fuerza",
      notes: WARMUP,
      blocks: [ARMS_SUPERSET],
      exercises: [
        {
          ex: "press_banca",
          sets: 4,
          reps: [6, 8],
          rir: 3,
          rest: 150,
          notes: "Escápulas retraídas y pies firmes. Toca el pecho sin rebotar.",
        },
        { ex: "remo_45", sets: 4, reps: [6, 8], rir: 3, rest: 150, notes: "Tronco a 45° y espalda neutra. Lleva la barra al ombligo." },
        { ex: "press_inclinado_mancuernas", sets: 3, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "jalon_prono", sets: 3, reps: [8, 10], rir: 2, rest: 120 },
        { ex: "elevaciones_laterales_polea", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "curl_barra_z", reps: [10, 12], rir: 2, isolation: true, block: "brazos" },
        { ex: "extension_triceps_cuerda", reps: [10, 12], rir: 2, isolation: true, block: "brazos" },
      ],
    },
    {
      name: "Pierna A · Rodilla",
      notes: WARMUP,
      exercises: [
        {
          ex: "sentadilla_barra_alta",
          sets: 4,
          reps: [6, 8],
          rir: 3,
          rest: 180,
          notes: "Rompe el paralelo si tu movilidad lo permite, con el tronco firme y las rodillas siguiendo la punta de los pies.",
        },
        { ex: "peso_muerto_rumano", sets: 3, reps: [8, 10], rir: 3, rest: 150, notes: "La barra baja pegada a las piernas; la cadera va atrás." },
        { ex: "prensa_45", sets: 3, reps: [10, 12], rir: 2, rest: 120 },
        { ex: "extension_cuadriceps", sets: 3, reps: [12, 15], rir: 2, rest: 75, isolation: true, notes: "Aguanta 1 segundo arriba." },
        { ex: "curl_femoral_sentado", sets: 3, reps: [10, 12], rir: 2, rest: 75, isolation: true },
        { ex: "gemelo_prensa", sets: 4, reps: [10, 15], rir: 2, rest: 60, isolation: true, notes: "Recorrido completo con pausa abajo." },
      ],
    },
    {
      name: "Torso B · Volumen",
      notes: WARMUP,
      blocks: [ARMS_SUPERSET],
      exercises: [
        { ex: "press_militar_barra", sets: 4, reps: [6, 8], rir: 3, rest: 150, notes: "De pie, glúteos y abdomen apretados. La barra sube en línea recta." },
        {
          ex: "dominadas",
          sets: 4,
          reps: [6, 10],
          rir: 2,
          rest: 150,
          notes: "Si no llegas a 6 repeticiones, usa la máquina de dominadas asistidas o una banda.",
        },
        { ex: "press_inclinado_maquina", sets: 3, reps: [8, 12], rir: 2, rest: 120 },
        { ex: "remo_mancuerna", sets: 3, reps: [8, 12], rir: 2, rest: 90, notes: "Repeticiones por brazo." },
        { ex: "pajaros_maquina", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "curl_martillo", reps: [10, 12], rir: 2, isolation: true, block: "brazos" },
        { ex: "extension_overhead_cuerda", reps: [10, 12], rir: 2, isolation: true, block: "brazos" },
      ],
    },
    {
      name: "Pierna B · Cadera",
      notes: WARMUP,
      exercises: [
        {
          ex: "peso_muerto",
          sets: 3,
          reps: [5, 6],
          rir: 3,
          rest: 180,
          notes: "Barra sobre el medio del pie, espalda neutra y empuja el suelo. Cada repetición empieza desde parado.",
        },
        { ex: "hip_thrust", sets: 4, reps: [8, 10], rir: 2, rest: 120, notes: "Barbilla al pecho y pausa de 1 segundo arriba." },
        { ex: "sentadilla_bulgara", sets: 3, reps: [8, 10], rir: 2, rest: 120, notes: "Repeticiones por pierna." },
        { ex: "curl_femoral_tumbado", sets: 3, reps: [10, 12], rir: 2, rest: 75, isolation: true },
        { ex: "abductores_maquina", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "rueda_abdominal", sets: 3, reps: [8, 12], rir: 2, rest: 60, notes: "Solo hasta donde mantengas la zona lumbar sin hundirse." },
      ],
    },
  ],
};
