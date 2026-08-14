// TASK-049 (MASTER_BACKLOG.md) — catálogo cerrado de los campos que puede
// mostrar el cuestionario inicial (intake). Mismo criterio que
// trainerCheckins/checkin-field-catalog.js: campos fijos y conocidos, el
// trainer elige cuáles activar, no puede inventar campos libres nuevos
// (evita el mismo problema de fondo que resolvió el catálogo cerrado de
// check-in — un campo custom sin tipo/validación es un problema distinto y
// mayor). Los 5 primeros viven en ClientIntake; los 4 últimos son en
// realidad ClientNutritionPreferences (F29), reutilizados aquí — ver
// trainer-client-service.js#submitIntake.
const INTAKE_FIELD_KEYS = [
  "goals",
  "healthConditions",
  "experienceLevel",
  "availability",
  "equipment",
  "allergies",
  "favoriteFoods",
  "dislikedFoods",
  "cooksAtHome",
];

module.exports = { INTAKE_FIELD_KEYS };
