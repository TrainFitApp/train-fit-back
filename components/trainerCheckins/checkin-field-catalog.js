// MVP-trainers F17 — catálogo cerrado de campos de check-in.
// Espejo EXACTO de packages/shared-core/src/app/core/constants/checkin-fields.ts
// (frontend) — mantenidos sincronizados a mano, ver modelos-de-datos/04-catalogo-campos-checkin.md, sección 10.
const CHECKIN_FIELDS = [
  // --- Composición corporal (storage: anthropometry) ---
  { key: "weight", label: "Peso", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "weight" },
  { key: "muscle_mass", label: "Masa muscular", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "muscleMass" },
  { key: "fat_mass", label: "Masa grasa", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "fatMass" },
  { key: "bone_mass", label: "Masa ósea", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "boneMass" },
  { key: "residual_mass", label: "Masa residual", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "residualMass" },

  // --- Perímetros (storage: anthropometry) ---
  { key: "perimeter_neck", label: "Cuello", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "neck" },
  { key: "perimeter_shoulders", label: "Hombros", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "shoulders" },
  { key: "perimeter_chest", label: "Pecho", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "chest" },
  { key: "perimeter_waist", label: "Cintura", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "waist" },
  { key: "perimeter_navel", label: "Ombligo", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "abdomen" },
  { key: "perimeter_hip", label: "Cadera", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "hip" },
  { key: "perimeter_bicep_relaxed_l", label: "Bíceps relajado izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsRelaxedL" },
  { key: "perimeter_bicep_relaxed_r", label: "Bíceps relajado der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsRelaxedR" },
  { key: "perimeter_bicep_flexed_l", label: "Bíceps contraído izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsContractedL" },
  { key: "perimeter_bicep_flexed_r", label: "Bíceps contraído der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsContractedR" },
  { key: "perimeter_quad_l", label: "Cuádriceps izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "quadL" },
  { key: "perimeter_quad_r", label: "Cuádriceps der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "quadR" },
  { key: "perimeter_thigh_relaxed", label: "Muslo relajado", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "thighRelaxed" },
  { key: "perimeter_thigh_flexed", label: "Muslo contraído", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "thighContracted" },
  { key: "perimeter_calf_l", label: "Gemelo izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "calfL" },
  { key: "perimeter_calf_r", label: "Gemelo der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "calfR" },
  { key: "perimeter_ankle_l", label: "Tobillo izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "ankleL" },
  { key: "perimeter_ankle_r", label: "Tobillo der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "ankleR" },

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

  // coach-tab FASE2 — campo de texto libre, reutilizable tanto en
  // "formularios" (comentario semanal) como en "revisiones" (comentario
  // junto a las medidas de composición corporal/perímetros de esa misma
  // respuesta). Un único campo genérico, no un mecanismo aparte.
  { key: "comment", label: "Comentario", type: "text", group: "bienestar", storage: "wellbeing" },
];

const CHECKIN_FIELD_KEYS = CHECKIN_FIELDS.map((f) => f.key);
const CHECKIN_FIELDS_BY_KEY = new Map(CHECKIN_FIELDS.map((f) => [f.key, f]));

module.exports = { CHECKIN_FIELDS, CHECKIN_FIELD_KEYS, CHECKIN_FIELDS_BY_KEY };
