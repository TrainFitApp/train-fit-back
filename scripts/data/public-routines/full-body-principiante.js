// Full Body de 3 días para quien empieza: máquinas y básicos con mancuernas,
// todos los patrones en cada sesión y lejos del fallo. Días alternos (lunes,
// miércoles y viernes).

const WARMUP =
  "Calentamiento: 5 min de cardio suave y 2 series de aproximación del primer ejercicio con poco peso. Descansa lo indicado entre series.";

module.exports = {
  name: "Full Body · 3 días · Principiante",
  workouts: [
    {
      name: "Full Body A",
      notes: WARMUP,
      exercises: [
        {
          ex: "goblet_squat",
          sets: 3,
          reps: [10, 12],
          rir: 3,
          rest: 90,
          notes: "Mancuerna pegada al pecho, pies a la anchura de los hombros. Baja con el tronco erguido hasta donde mantengas la espalda neutra.",
        },
        { ex: "press_plano_maquina", sets: 3, reps: [10, 12], rir: 3, rest: 90, notes: "Escápulas atrás y abajo. Baja en 2 segundos." },
        { ex: "jalon_neutro", sets: 3, reps: [10, 12], rir: 3, rest: 90, notes: "Tira con los codos hacia las costillas, sin balancear el tronco." },
        {
          ex: "peso_muerto_rumano_mancuernas",
          sets: 3,
          reps: [10, 12],
          rir: 3,
          rest: 90,
          notes: "Rodillas ligeramente flexionadas y cadera atrás. Baja hasta notar tensión en los femorales, sin redondear la espalda.",
        },
        { ex: "elevaciones_laterales_mancuernas", sets: 2, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "plancha", sets: 3, time: "0:30", rest: 45, notes: "Glúteos y abdomen apretados; el cuerpo en línea recta." },
      ],
    },
    {
      name: "Full Body B",
      notes: WARMUP,
      exercises: [
        { ex: "prensa_45", sets: 3, reps: [10, 12], rir: 3, rest: 90, notes: "Baja hasta 90° de rodilla sin despegar la zona lumbar del respaldo." },
        { ex: "remo_maquina", sets: 3, reps: [10, 12], rir: 3, rest: 90, notes: "Pecho apoyado. Junta las escápulas al final de cada repetición." },
        { ex: "press_militar_mancuerna", sets: 3, reps: [10, 12], rir: 3, rest: 90, notes: "Sentado con respaldo. Sin arquear la zona lumbar." },
        { ex: "curl_femoral_tumbado", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "curl_mancuernas", sets: 2, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "extension_triceps_cuerda", sets: 2, reps: [12, 15], rir: 2, rest: 60, isolation: true, notes: "Codos pegados al cuerpo; abre la cuerda abajo." },
      ],
    },
    {
      name: "Full Body C",
      notes: WARMUP,
      exercises: [
        { ex: "hip_thrust_maquina", sets: 3, reps: [10, 12], rir: 3, rest: 90, notes: "Pausa de 1 segundo arriba apretando el glúteo." },
        { ex: "press_inclinado_mancuernas", sets: 3, reps: [10, 12], rir: 3, rest: 90, notes: "Banco a 30°. Baja las mancuernas hasta la altura del pecho." },
        { ex: "remo_polea_baja", sets: 3, reps: [10, 12], rir: 3, rest: 90 },
        { ex: "zancadas", sets: 2, reps: [10, 12], rir: 3, rest: 90, notes: "Repeticiones por pierna. Paso largo y tronco erguido." },
        { ex: "facepull", sets: 2, reps: [12, 15], rir: 2, rest: 60, isolation: true, notes: "Cuerda a la altura de la frente; separa las manos al tirar." },
        { ex: "crunch_polea", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
      ],
    },
  ],
};
