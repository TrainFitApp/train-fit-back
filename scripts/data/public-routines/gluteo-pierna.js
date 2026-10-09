// Glúteo y pierna de 4 días: tres sesiones de tren inferior con el glúteo
// como prioridad (empuje de cadera, bisagra, unilaterales y abducción) y un
// torso de mantenimiento. Lunes, martes, jueves y sábado.

const WARMUP =
  "Calentamiento: 5 min de cardio suave, activación de glúteo (puente y abducción con banda, 2×15) y 2 series de aproximación del primer ejercicio.";

module.exports = {
  name: "Glúteo y pierna · 4 días",
  workouts: [
    {
      name: "Día 1 · Glúteo y femoral",
      notes: WARMUP,
      exercises: [
        { ex: "hip_thrust", sets: 4, reps: [8, 10], rir: 3, rest: 120, notes: "Barbilla al pecho, tibias verticales arriba y pausa de 1 segundo." },
        { ex: "peso_muerto_rumano", sets: 3, reps: [8, 10], rir: 3, rest: 120 },
        { ex: "sentadilla_bulgara", sets: 3, reps: [10, 12], rir: 2, rest: 90, notes: "Repeticiones por pierna. Tronco algo inclinado para cargar más el glúteo." },
        { ex: "patada_gluteo_polea", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true, notes: "Repeticiones por pierna." },
        { ex: "abductores_maquina", sets: 3, reps: [15, 20], rir: 2, rest: 60, isolation: true, notes: "Tronco inclinado hacia delante." },
        { ex: "curl_femoral_tumbado", sets: 3, reps: [10, 12], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Día 2 · Torso",
      notes: WARMUP,
      exercises: [
        { ex: "jalon_neutro", sets: 3, reps: [10, 12], rir: 2, rest: 90 },
        { ex: "press_inclinado_mancuernas", sets: 3, reps: [10, 12], rir: 2, rest: 90 },
        { ex: "remo_polea_baja", sets: 3, reps: [10, 12], rir: 2, rest: 90 },
        { ex: "elevaciones_laterales_mancuernas", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "facepull", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "plancha", sets: 3, time: "0:40", rest: 45 },
      ],
    },
    {
      name: "Día 3 · Cuádriceps y glúteo",
      notes: WARMUP,
      exercises: [
        { ex: "sentadilla_hack", sets: 4, reps: [8, 10], rir: 3, rest: 120 },
        { ex: "prensa_45", sets: 3, reps: [10, 12], rir: 2, rest: 120, notes: "Pies altos y algo abiertos en la plataforma: más glúteo y aductor." },
        { ex: "zancadas", sets: 3, reps: [10, 12], rir: 2, rest: 90, notes: "Repeticiones por pierna." },
        { ex: "extension_cuadriceps", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
        { ex: "gluteo_medio_polea", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true, notes: "Repeticiones por pierna." },
        { ex: "gemelo_maquina_pie", sets: 3, reps: [12, 15], rir: 2, rest: 60, isolation: true },
      ],
    },
    {
      name: "Día 4 · Glúteo y core",
      notes: WARMUP,
      exercises: [
        { ex: "hip_thrust_maquina", sets: 3, reps: [10, 12], rir: 2, rest: 90 },
        { ex: "peso_muerto_rumano_unilateral", sets: 3, reps: [10, 12], rir: 2, rest: 90, notes: "Repeticiones por pierna. Cadera nivelada." },
        { ex: "hiperextensiones_gluteo", sets: 3, reps: [12, 15], rir: 2, rest: 75, notes: "Espalda redondeada y pies girados hacia fuera para cargar el glúteo." },
        { ex: "abduccion_pie_maquina", sets: 3, reps: [15, 20], rir: 2, rest: 60, isolation: true },
        { ex: "press_pallof", sets: 3, reps: [10, 12], rir: 2, rest: 45, notes: "Repeticiones por lado. Que la cadera no gire." },
        { ex: "crunch_invertido", sets: 3, reps: [12, 15], rir: 2, rest: 45, isolation: true },
      ],
    },
  ],
};
