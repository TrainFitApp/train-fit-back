// Punto de partida del seguimiento según el objetivo del cliente.
//
// La regla que ordena esta tabla: cuanto más lento se mueve el objetivo,
// menos medidas. Un perímetro no cambia en siete días, pero la cinta sí — y
// esa variación falsa dispara alertas falsas y ruido en las gráficas. El
// peso es lo contrario: se mueve rápido, cuesta cero registrarlo, y una
// serie densa vale mucho más que una semanal.
//
// Nada de esto queda clavado: el entrenador ajusta cada pieza después. El
// preset existe para que el caso normal sea un clic, no para decidir por él.

const WELLBEING_BASE = [
  "training_adherence",
  "recovery_between_sessions",
  "sleep_quality",
  "general_fatigue",
  "stress_level",
  "comment",
];

const WELLBEING_NUTRITION = [...WELLBEING_BASE, "nutrition_plan_adherence", "hunger_satiety"];

// Composición de báscula: solo donde el dato cambia lo que el entrenador
// hace. En fuerza o movilidad, pedir masa grasa cada dos meses es pedir un
// número que nadie va a usar.
const SCALE = ["weight", "fat_mass", "muscle_mass"];

const TRACKING_PRESETS = [
  {
    key: "fat_loss",
    label: "Pérdida de grasa",
    // Casi a diario: es la señal más útil y la más barata de dar.
    weightIntervalDays: 2,
    wellbeing: { frequency: "weekly", interval: 1, fields: WELLBEING_NUTRITION },
    measurements: {
      frequency: "weekly",
      interval: 4,
      fields: [...SCALE, "perimeter_waist", "perimeter_navel", "perimeter_hip"],
    },
  },
  {
    key: "hypertrophy",
    label: "Hipertrofia",
    weightIntervalDays: 3,
    wellbeing: { frequency: "weekly", interval: 1, fields: WELLBEING_NUTRITION },
    measurements: {
      frequency: "weekly",
      interval: 6,
      fields: [
        ...SCALE,
        "perimeter_chest",
        "perimeter_waist",
        "perimeter_bicep_flexed_l",
        "perimeter_bicep_flexed_r",
        "perimeter_quad_l",
        "perimeter_quad_r",
      ],
    },
  },
  {
    key: "strength",
    label: "Fuerza",
    weightIntervalDays: 7,
    wellbeing: { frequency: "weekly", interval: 2, fields: WELLBEING_BASE },
    measurements: { frequency: "weekly", interval: 8, fields: ["weight", "perimeter_waist"] },
  },
  {
    key: "endurance",
    label: "Resistencia",
    weightIntervalDays: 7,
    wellbeing: { frequency: "weekly", interval: 1, fields: WELLBEING_BASE },
    measurements: { frequency: "weekly", interval: 8, fields: ["weight", "perimeter_waist"] },
  },
  {
    key: "health",
    label: "Movilidad / salud",
    weightIntervalDays: 7,
    wellbeing: { frequency: "weekly", interval: 2, fields: WELLBEING_BASE },
    // Trimestral: en salud general, medir más a menudo no cambia ninguna
    // decisión y sí convierte el seguimiento en una tarea pesada.
    measurements: { frequency: "monthly", interval: 3, fields: ["weight", "perimeter_waist"] },
  },
];

const PRESET_BY_KEY = new Map(TRACKING_PRESETS.map((preset) => [preset.key, preset]));

// El objetivo de entrenamiento que ya guarda la relación (TrainerClient
// .trainingGoalType) sugiere un preset, pero no lo impone: "pérdida de
// grasa" no es un objetivo de entrenamiento, y un cliente de hipertrofia
// puede estar en déficit.
const PRESET_BY_TRAINING_GOAL = {
  hypertrophy: "hypertrophy",
  strength: "strength",
  endurance: "endurance",
  mobility: "health",
  general: "health",
};

module.exports = { TRACKING_PRESETS, PRESET_BY_KEY, PRESET_BY_TRAINING_GOAL };
