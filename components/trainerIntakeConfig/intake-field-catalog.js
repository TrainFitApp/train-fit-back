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
  // Restricciones dietéticas estructuradas (vegano / sin gluten / ...) →
  // ClientNutritionPreferences.dietaryFlags. No es un campo que el
  // entrenador active/desactive: getOnboardingStatus lo fuerza siempre que
  // la relación es de scope "nutrition" (es esencial para pautar, no
  // opcional). Por eso NO aparece en el panel de checkboxes de invites.
  "dietaryFlags",
];

// Los que van a ClientNutritionPreferences (F29), no a ClientIntake — el
// resto viven en ClientIntake. Ver trainer-client-service.js#submitIntake.
const NUTRITION_PREFERENCE_KEYS = [
  "allergies",
  "favoriteFoods",
  "dislikedFoods",
  "cooksAtHome",
  "dietaryFlags",
];

module.exports = { INTAKE_FIELD_KEYS, NUTRITION_PREFERENCE_KEYS };
