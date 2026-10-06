// TASK-049 (MASTER_BACKLOG.md) — catálogo cerrado de los campos que puede
// mostrar el cuestionario inicial (intake). Mismo criterio que
// trainerCheckins/checkin-field-catalog.js: campos fijos y conocidos, el
// trainer elige cuáles activar, no puede inventar campos libres nuevos
// (evita el mismo problema de fondo que resolvió el catálogo cerrado de
// check-in — un campo custom sin tipo/validación es un problema distinto y
// mayor). Los 5 primeros son respuestas del cuestionario (TrainerClient.intake);
// los de nutrición van a User.nutritionPreferences — ver
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
  // User.nutritionPreferences.dietaryFlags. No es un campo que el
  // entrenador active/desactive: getOnboardingStatus lo fuerza siempre que
  // la relación es de scope "nutrition" (es esencial para pautar, no
  // opcional). Por eso NO aparece en el panel de checkboxes de invites.
  "dietaryFlags",
  // Datos que el cliente YA metió al registrarse — el intake solo los
  // confirma/actualiza y los reescribe en `User`. También forzados (no
  // toggleables), para toda relación: el entrenador siempre los necesita
  // para calcular objetivo/carga.
  //   profileBiometrics -> peso (medida de hoy) y User.height/sex/birth
  //   activityProfile   -> User.steps/activity/training
  //   objective         -> User.objetive (déficit / mantenimiento / superávit)
  "profileBiometrics",
  "activityProfile",
  "objective",
];

// Claves que se reescriben en `User` (ni en el cuestionario ni en las
// preferencias de nutrición). Ver trainer-client-service.js#submitIntake.
const USER_PROFILE_KEYS = ["profileBiometrics", "activityProfile", "objective"];

// Los que van a User.nutritionPreferences, no al cuestionario. Ver
// trainer-client-service.js#submitIntake.
const NUTRITION_PREFERENCE_KEYS = [
  "allergies",
  "favoriteFoods",
  "dislikedFoods",
  "cooksAtHome",
  "dietaryFlags",
];

module.exports = { INTAKE_FIELD_KEYS, NUTRITION_PREFERENCE_KEYS, USER_PROFILE_KEYS };
