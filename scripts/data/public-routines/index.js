// Rutinas públicas que siembra scripts/seed-public-routines.js: rutinas sin
// dueño que todos los clientes ven en «Rutinas» y que los profesionales
// pueden asignar como plantilla. Cada una es un bloque de 4 semanas
// (mesocycle.js): un microciclo por semana con las mismas sesiones.
//
// Formato de cada rutina:
//   name       nombre de la rutina (único entre las públicas)
//   workouts   sesiones en orden: { name, notes, blocks?, exercises }
//
// Bloques de una sesión: { key, type, name, rounds, restBetweenExercises,
// restBetweenRounds, instructions }; `key` solo sirve para que los
// ejercicios digan a qué bloque van.
//
// Cada ejercicio:
//   ex         clave de exercises.js
//   sets       series de la semana 1 (dentro de un bloque, las rondas del bloque)
//   reps       [mín, máx] o [exactas]
//   rir        repeticiones en reserva de la semana 1 (opcional)
//   time       "M:SS" en vez de reps y RIR (cardio e isométricos)
//   rest       descanso tras cada serie, en segundos (en un bloque lo marca el bloque)
//   isolation  ejercicio de aislamiento: su última serie va al fallo en la semana 3
//   block      clave del bloque de la sesión al que pertenece
//   notes      indicación del entrenador

const { WEEKS, DELOAD_RIR } = require("./mesocycle");

module.exports = {
  EXERCISES: require("./exercises"),
  WEEKS,
  DELOAD_RIR,
  ROUTINES: [
    require("./full-body-principiante"),
    require("./torso-pierna-intermedio"),
    require("./push-pull-legs-avanzado"),
    require("./fuerza-5x5"),
    require("./gluteo-pierna"),
    require("./casa-mancuernas"),
    require("./weider-5-dias"),
    require("./circuitos-quema-grasa"),
  ],
};
