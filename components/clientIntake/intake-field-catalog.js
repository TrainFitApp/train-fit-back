// Catálogo único de campos del cuestionario inicial. Los 4 "shared" no se
// guardan en ClientIntake (por relación) — viven en el perfil global de
// preferencias nutricionales del cliente (ver nutritionPreferences) y el
// cuestionario simplemente lee/escribe ahí. Ver
// docs/trainfit-trainers/05-especificaciones-acordadas.md, funcionalidad 3.
const INTAKE_FIELDS = {
  goals: { scope: "relation" },
  healthConditions: { scope: "relation" },
  experienceLevel: { scope: "relation" },
  availability: { scope: "relation" },
  equipment: { scope: "relation" },
  allergies: { scope: "shared" },
  favoriteFoods: { scope: "shared" },
  dislikedFoods: { scope: "shared" },
  cooksAtHome: { scope: "shared" },
};

const RELATION_FIELD_KEYS = Object.keys(INTAKE_FIELDS).filter(
  (key) => INTAKE_FIELDS[key].scope === "relation"
);
const SHARED_FIELD_KEYS = Object.keys(INTAKE_FIELDS).filter(
  (key) => INTAKE_FIELDS[key].scope === "shared"
);

module.exports = { INTAKE_FIELDS, RELATION_FIELD_KEYS, SHARED_FIELD_KEYS };
