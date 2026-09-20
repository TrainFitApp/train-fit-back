// MVP-trainers F17 — catálogo cerrado de campos de check-in.
// Espejo EXACTO de packages/shared-core/src/app/core/constants/checkin-fields.ts
// (frontend) — mantenidos sincronizados a mano, ver modelos-de-datos/04-catalogo-campos-checkin.md, sección 10.
//
// Movimiento 2 Coach Pro — dos campos nuevos en cada definición:
//
//   anchors  Qué significa CADA nivel de una escala, escrito en la lengua
//            del cliente. Sin esto, un "3 de estrés" no es un dato: cada
//            cliente lo interpreta a su manera, y peor aún, el MISMO cliente
//            lo interpreta distinto en semanas distintas — que es lo que
//            hace inútil la serie temporal entera. Su LONGITUD define el
//            rango válido de la escala (ver checkin-controller.js), así que
//            una escala de 8 niveles como el color de orina no necesita
//            ningún tipo nuevo.
//
//   hint     Cómo tomar la medida. Un perímetro de cintura medido un día por
//            el ombligo y otro por la parte más estrecha da una "variación"
//            de 4 cm que no ha ocurrido. La instrucción no sobra: es lo que
//            hace comparables dos medidas de dos semanas distintas.
//
//   min/max  Cotas de PLAUSIBILIDAD de una medida numérica.
//
//            Existen por un fallo real: a un cliente le llegó la alerta
//            "Ombligo ha bajado 44,0 cm (-35,8%)". Nadie pierde 44 cm de
//            ombligo — era una errata al teclear, y el motor de señales se
//            la creyó y construyó un relato encima. Un número imposible no
//            es un dato: es ruido con formato de dato, y es peor que un
//            hueco porque nadie duda de él.
//
//            Deliberadamente ANCHAS. No están para vigilar el físico de
//            nadie, están para cazar el dedo que resbala: un ombligo de 44,
//            una cintura de 800, un peso de 7. Entre esas cotas cabe
//            cualquier persona real.
//
// Los PASOS no son un campo de check-in: se pautan como HÁBITO diario
// (TrainerTask type "steps") y el cliente los marca cada día bajo sus
// comidas. Ver docs/plan-revisiones.md §12.

const CHECKIN_FIELDS = [
  // --- Composición corporal (storage: anthropometry) ---
  { key: "weight", label: "Peso", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "weight", hint: "Al levantarte, después de ir al baño y antes de desayunar. Siempre el mismo día de la semana.", min: 25, max: 350 },
  { key: "muscle_mass", label: "Masa muscular", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "muscleMass", hint: "De la báscula de bioimpedancia, en las mismas condiciones que el peso.", min: 1, max: 200 },
  { key: "fat_mass", label: "Masa grasa", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "fatMass", hint: "De la báscula de bioimpedancia, en las mismas condiciones que el peso.", min: 1, max: 200 },
  { key: "bone_mass", label: "Masa ósea", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "boneMass", hint: "De la báscula de bioimpedancia, en las mismas condiciones que el peso.", min: 0.5, max: 20 },
  { key: "residual_mass", label: "Masa residual", type: "number", unit: "kg", group: "composicion_corporal", storage: "anthropometry", anthropometryField: "residualMass", hint: "De la báscula de bioimpedancia, en las mismas condiciones que el peso.", min: 1, max: 100 },

  // --- Perímetros (storage: anthropometry) ---
  // Cada instrucción dice el PUNTO exacto y la POSTURA. Son las dos cosas
  // que, si cambian entre semanas, inventan una variación que no existe.
  { key: "perimeter_neck", label: "Cuello", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "neck", hint: "Justo por debajo de la nuez, con la cinta horizontal y el cuello relajado.", min: 20, max: 80 },
  { key: "perimeter_shoulders", label: "Hombros", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "shoulders", hint: "Por la parte más ancha de los hombros, de pie y con los brazos colgando.", min: 70, max: 220 },
  { key: "perimeter_chest", label: "Pecho", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "chest", hint: "A la altura de los pezones, al terminar de soltar el aire con normalidad.", min: 50, max: 220 },
  { key: "perimeter_waist", label: "Cintura", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "waist", hint: "Por la parte más estrecha, entre la última costilla y la cadera. Sin meter tripa.", min: 45, max: 220 },
  { key: "perimeter_navel", label: "Ombligo", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "abdomen", hint: "A la altura exacta del ombligo. Sin meter tripa ni sacar el aire.", min: 45, max: 220 },
  { key: "perimeter_hip", label: "Cadera", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "hip", hint: "Por la parte más ancha de los glúteos, de pie y con los pies juntos.", min: 45, max: 220 },
  { key: "perimeter_bicep_relaxed_l", label: "Bíceps relajado izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsRelaxedL", hint: "Brazo colgando relajado, por la parte más ancha.", min: 12, max: 90 },
  { key: "perimeter_bicep_relaxed_r", label: "Bíceps relajado der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsRelaxedR", hint: "Brazo colgando relajado, por la parte más ancha.", min: 12, max: 90 },
  { key: "perimeter_bicep_flexed_l", label: "Bíceps contraído izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsContractedL", hint: "Codo a 90° y bíceps apretado, por la parte más ancha.", min: 12, max: 90 },
  { key: "perimeter_bicep_flexed_r", label: "Bíceps contraído der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "bicepsContractedR", hint: "Codo a 90° y bíceps apretado, por la parte más ancha.", min: 12, max: 90 },
  { key: "perimeter_quad_l", label: "Cuádriceps izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "quadL", hint: "A un palmo por encima de la rodilla, de pie y con el peso repartido en los dos pies.", min: 25, max: 120 },
  { key: "perimeter_quad_r", label: "Cuádriceps der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "quadR", hint: "A un palmo por encima de la rodilla, de pie y con el peso repartido en los dos pies.", min: 25, max: 120 },
  { key: "perimeter_thigh_relaxed", label: "Muslo relajado", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "thighRelaxed", hint: "Justo debajo del glúteo, de pie y con la pierna relajada.", min: 25, max: 120 },
  { key: "perimeter_thigh_flexed", label: "Muslo contraído", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "thighContracted", hint: "En el mismo punto que el muslo relajado, apretando la pierna.", min: 25, max: 120 },
  { key: "perimeter_calf_l", label: "Gemelo izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "calfL", hint: "Por la parte más ancha, de pie y con el peso repartido en los dos pies.", min: 15, max: 80 },
  { key: "perimeter_calf_r", label: "Gemelo der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "calfR", hint: "Por la parte más ancha, de pie y con el peso repartido en los dos pies.", min: 15, max: 80 },
  { key: "perimeter_ankle_l", label: "Tobillo izq.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "ankleL", hint: "Por la parte más estrecha, justo por encima del hueso.", min: 10, max: 50 },
  { key: "perimeter_ankle_r", label: "Tobillo der.", type: "number", unit: "cm", group: "perimetros", storage: "anthropometry", anthropometryField: "ankleR", hint: "Por la parte más estrecha, justo por encima del hueso.", min: 10, max: 50 },

  // --- Bienestar semanal (storage: wellbeing) ---
  // El orden de las anclas SIEMPRE va de menos a más de lo que nombra la
  // etiqueta: 5 en "Cansancio general" es más cansancio, 5 en "Calidad del
  // sueño" es mejor sueño. Mezclar direcciones dentro del mismo formulario
  // es la vía rápida a que el cliente conteste al revés sin darse cuenta.
  {
    key: "recovery_between_sessions",
    label: "Recuperación entre sesiones",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "Llego a la siguiente sesión igual de cansado que al terminar la anterior",
      "Me recupero a medias: arrastro cansancio a la sesión siguiente",
      "Llego recuperado, pero justo",
      "Llego recuperado con margen",
      "Llego entero, podría haber entrenado antes",
    ],
  },
  {
    key: "training_adherence",
    label: "Seguimiento del entrenamiento",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "No he hecho ninguna sesión",
      "He hecho menos de la mitad de las sesiones",
      "He hecho más o menos la mitad",
      "He hecho casi todas, con algún cambio",
      "He hecho todas las sesiones tal y como estaban",
    ],
  },
  {
    key: "hunger_satiety",
    label: "Nivel de hambre-saciedad",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    // Escala de hambre a saciedad: 1 es hambre constante, 5 es saciedad
    // excesiva. El punto bueno es el 3, no el 5 — se dice en el propio
    // texto del nivel para que no se lea como "más es mejor".
    anchors: [
      "Hambre constante, pienso en comer todo el día",
      "Me quedo con hambre después de comer",
      "Termino satisfecho y aguanto bien hasta la comida siguiente",
      "Me cuesta terminar alguna comida",
      "Me sobra comida, como sin ganas",
    ],
  },
  {
    key: "hydration_level",
    label: "Grado de hidratación",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "Casi no bebo agua, suelo tener sed",
      "Bebo poco, me acuerdo solo a ratos",
      "Bebo lo normal, sin llevar la cuenta",
      "Bebo de forma constante durante el día",
      "Bebo lo pautado todos los días",
    ],
  },
  {
    key: "stress_level",
    label: "Nivel de estrés",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "Tranquilo, sin nada que me agobie",
      "Algo de tensión puntual, se me pasa",
      "Estrés de fondo constante, pero manejable",
      "Bastante estrés, me cuesta desconectar",
      "Desbordado: me afecta al sueño y al apetito",
    ],
  },
  {
    key: "motivation_level",
    label: "Grado de motivación",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "Me cuesta hasta abrir la app",
      "Entreno por obligación",
      "Voy cumpliendo, sin más",
      "Con ganas la mayoría de los días",
      "Con muchas ganas, me sobra motivación",
    ],
  },
  { key: "sleep_hours", label: "Horas de sueño semanales", type: "number", unit: "h", group: "bienestar", storage: "wellbeing", hint: "Suma las horas que has dormido esta semana y divídelas entre 7.", min: 0, max: 24 },
  {
    key: "sleep_quality",
    label: "Calidad del sueño",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "Me despierto varias veces y amanezco roto",
      "Duermo mal: me cuesta dormirme o me desvelo",
      "Duermo regular, ni bien ni mal",
      "Duermo bien casi todas las noches",
      "Duermo del tirón y amanezco descansado",
    ],
  },
  {
    key: "general_fatigue",
    label: "Cansancio general",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "Con energía todo el día",
      "Algo de cansancio a última hora",
      "Cansado por la tarde, dentro de lo normal",
      "Cansado casi todo el día",
      "Agotado: me cuesta hacer vida normal",
    ],
  },
  {
    key: "nutrition_plan_adherence",
    label: "Seguimiento del plan nutricional",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    anchors: [
      "No he seguido el plan",
      "Lo he seguido menos de la mitad de los días",
      "Lo he seguido más o menos la mitad de los días",
      "Lo he seguido casi todos los días",
      "Lo he seguido todos los días",
    ],
  },

  // Movimiento 2 Coach Pro — escala de color de orina (§ hidratación).
  //
  // Campo NUEVO y no una redefinición de hydration_level: cambiar aquella de
  // 5 a 8 niveles reinterpretaría en silencio todo el histórico ya guardado
  // (un 4 de "bebo de forma constante" pasaría a leerse como un color), y
  // las series y las reglas compararían números que ya no significan lo
  // mismo. Con una clave nueva, lo viejo sigue queriendo decir lo que decía.
  //
  // Es la única escala del catálogo que no tiene 5 niveles: el rango lo
  // define anchors.length, no el nombre del tipo.
  {
    key: "urine_color",
    label: "Color de la orina",
    type: "scale_1_5",
    group: "bienestar",
    storage: "wellbeing",
    hint: "Míralo a media mañana, no en la primera orina del día. Del 1 al 3 estás bien hidratado; del 4 al 5, bebe más; del 6 en adelante, estás deshidratado.",
    anchors: [
      "Transparente, casi como agua",
      "Amarillo muy claro",
      "Amarillo claro",
      "Amarillo pajizo",
      "Amarillo oscuro",
      "Ámbar",
      "Ámbar oscuro",
      "Marrón claro",
    ],
  },

  // coach-tab FASE2 — campo de texto libre, reutilizable tanto en
  // "formularios" (comentario semanal) como en "revisiones" (comentario
  // junto a las medidas de composición corporal/perímetros de esa misma
  // respuesta). Un único campo genérico, no un mecanismo aparte.
  { key: "comment", label: "Comentario", type: "text", group: "bienestar", storage: "wellbeing" },
];

const CHECKIN_FIELD_KEYS = CHECKIN_FIELDS.map((f) => f.key);
const CHECKIN_FIELDS_BY_KEY = new Map(CHECKIN_FIELDS.map((f) => [f.key, f]));

// Niveles válidos de una escala del catálogo. Sale de las anclas para que
// añadir una escala con otro número de niveles no exija tocar la validación
// ni el formulario. 5 es el valor por defecto de las escalas sin anclas
// (hoy ninguna del catálogo, pero sí las preguntas propias del coach).
const DEFAULT_SCALE_LEVELS = 5;

function scaleLevelsFor(field) {
  return field?.anchors?.length || DEFAULT_SCALE_LEVELS;
}

/**
 * ¿Es este valor una medida creíble para este campo?
 *
 * Un campo SIN cotas devuelve true: no todas las medidas tienen un rango
 * humano conocido, y ante la duda se acepta. Lo que no puede pasar es lo
 * contrario — descartar en silencio un dato bueno.
 *
 * Lo usan tres sitios, y los tres importan:
 *   - el formulario del cliente, para avisar en el momento de teclearlo;
 *   - el controller, para no guardarlo;
 *   - el motor de señales, para no construir una alerta sobre datos ya
 *     guardados antes de que existieran estas cotas.
 */
function isPlausibleValue(field, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (field?.min !== undefined && value < field.min) return false;
  if (field?.max !== undefined && value > field.max) return false;
  return true;
}

// Lo mismo, buscando el campo por su nombre en Anthropometry (waist, abdomen…)
// en vez de por su clave de catálogo. Es como lo necesitan las series del
// motor de señales y las del progreso, que trabajan sobre documentos de
// Anthropometry y no sobre respuestas de check-in.
const FIELD_BY_ANTHROPOMETRY = new Map(
  CHECKIN_FIELDS.filter((f) => f.anthropometryField).map((f) => [f.anthropometryField, f])
);

function isPlausibleAnthropometry(anthropometryField, value) {
  return isPlausibleValue(FIELD_BY_ANTHROPOMETRY.get(anthropometryField), value);
}


// Variación por semana por encima de la cual el cambio no es un cambio, es
// una errata. MUY por encima del umbral que dispara la ALERTA de cambio
// brusco (sharpMeasurementChangePct = 3): esto no compite con esa señal, la
// protege de datos basura.
//
// Es el filtro que de verdad cazaba el caso real: la alerta decía "Ombligo
// ha bajado 44,0 cm (-35,8%)", y los dos valores —123 y 79— son plausibles
// POR SEPARADO. Lo imposible era el salto entre ellos. Las cotas min/max de
// arriba cazan el otro tipo de errata (una cintura de 800); esta caza la de
// teclear un número de otra persona.
const MAX_PLAUSIBLE_CHANGE_PCT_PER_WEEK = {
  // Un perímetro que se mueve más de un 8% semanal no es tejido, es un dedo
  // en la tecla equivocada. Perder 8 cm de cintura de 100 en una semana ya
  // sería extraordinario.
  perimetros: 8,
  // El peso sí se mueve rápido (agua, glucógeno, vaciado). 6% semanal es
  // muchísimo pero llega a pasar; el doble, no.
  composicion_corporal: 12,
};

/**
 * ¿Es creíble pasar de `previousValue` a `currentValue` en `spanDays` días?
 *
 * Devuelve true cuando no hay con qué comparar (primera medición, mismo día,
 * valores ausentes): ante la duda NO se descarta. Descartar un dato bueno es
 * peor que dejar pasar uno malo, porque el malo todavía tiene que superar el
 * umbral de la alerta para llegar a nadie.
 */
function isPlausibleChange(field, previousValue, currentValue, spanDays) {
  if (typeof previousValue !== "number" || typeof currentValue !== "number") return true;
  if (!previousValue) return true;
  // Mismo día o fechas al revés: no hay ventana sobre la que normalizar.
  if (!Number.isFinite(spanDays) || spanDays <= 0) return true;

  const limit = MAX_PLAUSIBLE_CHANGE_PCT_PER_WEEK[field?.group];
  if (!limit) return true;

  const changePct = Math.abs((currentValue - previousValue) / previousValue) * 100;
  return changePct / (spanDays / 7) <= limit;
}

function isPlausibleAnthropometryChange(anthropometryField, previousValue, currentValue, spanDays) {
  return isPlausibleChange(
    FIELD_BY_ANTHROPOMETRY.get(anthropometryField),
    previousValue,
    currentValue,
    spanDays
  );
}

module.exports = {
  CHECKIN_FIELDS,
  CHECKIN_FIELD_KEYS,
  CHECKIN_FIELDS_BY_KEY,
  DEFAULT_SCALE_LEVELS,
  scaleLevelsFor,
  isPlausibleValue,
  isPlausibleAnthropometry,
  MAX_PLAUSIBLE_CHANGE_PCT_PER_WEEK,
  isPlausibleChange,
  isPlausibleAnthropometryChange,
};
