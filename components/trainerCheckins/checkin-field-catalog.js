// Catálogo cerrado de campos de check-in (funcionalidad 10) — única fuente,
// el frontend lo obtiene vía GET /trainer/checkin-fields, sin copia local
// (ver docs/trainfit-trainers/05-especificaciones-acordadas.md).
//
// Alcance recortado respecto a refactor-claude (31 campos): los campos
// "anthropometry" aquí se limitan a los que YA existen en
// components/anthropometry/anthropometry-schema.js de este repo — ese
// schema no tiene composición corporal (masa muscular/grasa/ósea/residual)
// ni perímetros con lado izquierdo/derecho separado, solo un perímetro por
// zona. Ampliar Anthropometry con esos campos nuevos sería un cambio de
// modelo a un componente compartido por TODA la app (no solo trainers), así
// que se deja fuera de esta pasada — no se inventan campos que no existen.
const CHECKIN_FIELDS = [
  // --- Composición corporal / perímetros (storage: anthropometry) ---
  { key: "weight", label: "Peso", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "weight" },
  { key: "perimeter_neck", label: "Cuello", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "neck" },
  { key: "perimeter_chest", label: "Pecho", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "chest" },
  { key: "perimeter_biceps_relaxed", label: "Bíceps relajado", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsRelaxed" },
  { key: "perimeter_biceps_contracted", label: "Bíceps contraído", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsContracted" },
  { key: "perimeter_waist", label: "Cintura", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "waist" },
  { key: "perimeter_abdomen", label: "Ombligo", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "abdomen" },
  { key: "perimeter_hip", label: "Cadera", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "hip" },
  { key: "perimeter_thigh_relaxed", label: "Muslo relajado", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "thighRelaxed" },
  { key: "perimeter_thigh_contracted", label: "Muslo contraído", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "thighContracted" },
  { key: "perimeter_calf", label: "Gemelo", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "calf" },

  // --- Bienestar semanal (storage: wellbeing) ---
  { key: "recovery_between_sessions", label: "Recuperación entre sesiones", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "training_adherence", label: "Seguimiento del entrenamiento", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "hunger_satiety", label: "Nivel de hambre-saciedad", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "hydration_level", label: "Grado de hidratación", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "stress_level", label: "Nivel de estrés", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "motivation_level", label: "Grado de motivación", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "sleep_hours", label: "Horas de sueño semanales", type: "number", unit: "h", group: "bienestar", storage: "wellbeing" },
  { key: "sleep_quality", label: "Calidad del sueño", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "general_fatigue", label: "Cansancio general", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "daily_steps", label: "Pasos diarios (media semanal)", type: "number", unit: "pasos", group: "bienestar", storage: "wellbeing" },
  { key: "nutrition_plan_adherence", label: "Seguimiento del plan nutricional", type: "scale_1_5", group: "bienestar", storage: "wellbeing" },
  { key: "comment", label: "Comentario", type: "text", group: "bienestar", storage: "wellbeing" },
];

const CHECKIN_FIELD_KEYS = CHECKIN_FIELDS.map((f) => f.key);
const CHECKIN_FIELDS_BY_KEY = new Map(CHECKIN_FIELDS.map((f) => [f.key, f]));

module.exports = { CHECKIN_FIELDS, CHECKIN_FIELD_KEYS, CHECKIN_FIELDS_BY_KEY };
