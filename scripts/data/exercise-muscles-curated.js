// Músculos y énfasis del catálogo global de ejercicios (2026-09).
//
// Lo usa scripts/migrate-exercise-muscles.js. Revisado ejercicio a ejercicio
// contra los nombres reales del catálogo, en vez de convertir los
// muscleGroups1/2 antiguos, porque esos datos tienen errores de criterio,
// no solo erratas: "Upper back" y "Sentadilla sissy en máquina" figuraban
// como glúteo, "Oblicuos en máquina" como espalda, las sentadillas contaban
// femoral y el curl martillo era un curl de bíceps más.
//
// CRITERIO
// - primary (×1): el músculo que el ejercicio busca y que limita la serie.
//   Dos como máximo, y solo cuando ambos llegan de verdad cerca del fallo
//   (sentadilla: cuádriceps y glúteo mayor).
// - secondary (×0,5): colabora con carga relevante en todo el recorrido.
// - stabilizer (×0): trabaja en isométrico para sostener la postura. Se
//   muestra en la ficha, pero no suma volumen.
//
// DECISIONES QUE UN ENTRENADOR PUEDE ECHAR EN FALTA (y por qué)
// - Sentadillas y prensas NO cuentan isquiosurales: el femoral apenas cambia
//   de longitud al ponerse en cuclillas y no crece con ellas (Kubo 2019). Sí
//   cuentan aductores: el aductor mayor es extensor de cadera y crece tanto
//   como el glúteo en la sentadilla profunda.
// - El recto femoral solo es primario en ejercicios de extensión de rodilla
//   con la cadera extendida (extensión de cuádriceps, sissy): en la
//   sentadilla se acorta por la cadera y se estira por la rodilla a la vez,
//   y crece poco con ella (Maeo 2021). Las sentadillas cargan los vastos.
// - Tríceps: extensiones por encima de la cabeza, cabeza larga (Maeo 2022);
//   jalones, patadas y presses, cabezas lateral y medial.
// - Bíceps: con el hombro por detrás del cuerpo (inclinado, bayesian),
//   cabeza larga; con el hombro por delante (predicador, araña,
//   concentrado), cabeza corta; agarre neutro o prono, braquial y
//   braquiorradial.
// - Pectoral: press plano, porción media; inclinado y cruces ascendentes,
//   superior; declinado, fondos y cruces descendentes, inferior.
// - Remos: codo pegado y tirón hacia la cadera, dorsal; codo abierto y
//   tirón hacia el pecho, trapecio medio y romboides. Los remos libres con
//   el torso inclinado llevan el lumbar como estabilizador.
// - El cardio y los ejercicios de acondicionamiento no suman series de
//   hipertrofia: se dejan sin músculos a propósito.

function m(primary, secondary = [], stabilizer = []) {
  return [
    ...primary.map((muscle) => ({ muscle, role: "primary" })),
    ...secondary.map((muscle) => ({ muscle, role: "secondary" })),
    ...stabilizer.map((muscle) => ({ muscle, role: "stabilizer" })),
  ];
}

// --- Perfiles por familia de movimiento ---

// Pectoral
const FLAT_PRESS = m(["chest_middle"], ["delt_front", "triceps_lateral_medial"]);
const INCLINE_PRESS = m(["chest_upper"], ["delt_front", "triceps_lateral_medial"]);
const DECLINE_PRESS = m(["chest_lower"], ["triceps_lateral_medial", "delt_front"]);
const CLOSE_GRIP_PRESS = m(["triceps_lateral_medial", "chest_middle"], ["delt_front"]);
const LANDMINE_PRESS = m(["chest_upper"], ["delt_front", "triceps_lateral_medial"], ["abs_obliques"]);
const FLAT_FLY = m(["chest_middle"], ["delt_front"]);
const INCLINE_FLY = m(["chest_upper"], ["delt_front"]);
const DECLINE_FLY = m(["chest_lower"]);
const SVEND_FLAT = m(["chest_middle"], ["delt_front"]);
const SVEND_INCLINE = m(["chest_upper"], ["delt_front"]);
const PUSHUP = m(["chest_middle"], ["triceps_lateral_medial", "delt_front"], ["abs_rectus"]);
const PUSHUP_FEET_UP = m(["chest_upper"], ["delt_front", "triceps_lateral_medial"], ["abs_rectus"]);
const CHEST_DIP = m(["chest_lower"], ["triceps_lateral_medial", "delt_front"]);

// Tríceps
const TRICEPS_DIP = m(["triceps_lateral_medial"], ["chest_lower", "delt_front"]);
const BENCH_DIP = m(["triceps_lateral_medial"], ["delt_front"]);
const KAZ_PRESS = m(["triceps_lateral_medial"], ["chest_middle", "delt_front"]);
const TRICEPS_OVERHEAD = m(["triceps_long"], ["triceps_lateral_medial"]);
const TRICEPS_PUSHDOWN = m(["triceps_lateral_medial"], ["triceps_long"]);
const TRICEPS_KICKBACK = m(["triceps_lateral_medial"]);
// Hombro a unos 90°: ni estira ni acorta del todo la cabeza larga. Se deja
// en el grupo, sin porción, para no inventar un sesgo.
const TRICEPS_SKULL = m(["triceps"]);
const TRICEPS_MACHINE = m(["triceps"]);

// Hombro
const OVERHEAD_PRESS_STANDING = m(["delt_front"], ["delt_side", "triceps_lateral_medial"], ["abs_rectus", "lower_back"]);
const OVERHEAD_PRESS_SEATED = m(["delt_front"], ["delt_side", "triceps_lateral_medial"]);
const BEHIND_NECK_PRESS = m(["delt_front", "delt_side"], ["triceps_lateral_medial", "back_upper_traps"]);
const ARNOLD_PRESS = m(["delt_front"], ["delt_side", "triceps_lateral_medial"]);
const PUSH_PRESS = m(["delt_front"], ["triceps_lateral_medial", "delt_side"], ["quads_vasti", "glute_max"]);
const LATERAL_RAISE = m(["delt_side"], [], ["back_upper_traps"]);
const FRONT_RAISE = m(["delt_front"], ["chest_upper"]);
const REAR_DELT_FLY = m(["delt_rear"], ["back_mid_traps"]);
const FACE_PULL = m(["delt_rear"], ["back_mid_traps"], ["back_upper_traps"]);
const UPRIGHT_ROW = m(["delt_side"], ["back_upper_traps"]);

// Espalda — tirones verticales
const VERTICAL_PULL = m(["back_lats"], ["biceps", "back_mid_traps"], ["forearm_flexors"]);
const VERTICAL_PULL_NEUTRAL = m(["back_lats"], ["biceps_brachialis", "biceps", "back_mid_traps"], ["forearm_flexors"]);
const VERTICAL_PULL_SUPINE = m(["back_lats"], ["biceps", "back_mid_traps"], ["forearm_flexors"]);
const BEHIND_NECK_PULLDOWN = m(["back_lats"], ["back_mid_traps", "delt_rear", "biceps"]);
const PULLOVER_DUMBBELL = m(["back_lats"], ["chest_middle", "triceps_long"]);
const PULLOVER_CABLE = m(["back_lats"], ["triceps_long"]);

// Espalda — remos
const ROW_BENT_OVER = m(["back_lats", "back_mid_traps"], ["delt_rear", "biceps"], ["lower_back", "forearm_flexors"]);
const ROW_BENT_SUPINE = m(["back_lats"], ["back_mid_traps", "biceps", "delt_rear"], ["lower_back", "forearm_flexors"]);
const ROW_MEADOWS = m(["back_lats"], ["back_mid_traps", "delt_rear", "biceps"], ["lower_back"]);
const ROW_LATS = m(["back_lats"], ["back_mid_traps", "biceps"], ["forearm_flexors"]);
const ROW_LATS_SUPINE = m(["back_lats"], ["biceps", "back_mid_traps"]);
const ROW_WIDE = m(["back_mid_traps"], ["delt_rear", "back_lats", "biceps"]);
const ROW_CHEST_SUPPORTED = m(["back_mid_traps"], ["back_lats", "delt_rear", "biceps"]);
const ROW_MACHINE = m(["back_lats", "back_mid_traps"], ["delt_rear", "biceps"]);
const ROW_HIGH_MACHINE = m(["back_lats"], ["back_mid_traps", "biceps", "delt_rear"]);
const ROW_INVERTED = m(["back_mid_traps"], ["back_lats", "delt_rear", "biceps"], ["abs_rectus"]);
const UPPER_BACK_MACHINE = m(["back_mid_traps"], ["delt_rear"]);
const SHRUG = m(["back_upper_traps"], [], ["forearm_flexors"]);

// Bisagra de cadera
const DEADLIFT = m(["glute_max", "lower_back"], ["hamstrings", "quads_vasti", "adductors", "back_upper_traps"], ["back_lats", "forearm_flexors"]);
const DEADLIFT_TRAP_BAR = m(["quads_vasti", "glute_max"], ["hamstrings", "lower_back", "adductors", "back_upper_traps"], ["forearm_flexors"]);
const DEADLIFT_SUMO = m(["glute_max", "adductors"], ["quads_vasti", "lower_back", "hamstrings"], ["back_upper_traps", "forearm_flexors"]);
const ROMANIAN_DEADLIFT = m(["hamstrings"], ["glute_max", "adductors", "lower_back"], ["back_lats", "forearm_flexors"]);
const ROMANIAN_DEADLIFT_SINGLE = m(["hamstrings", "glute_max"], ["glute_med", "adductors"], ["lower_back"]);
const GOOD_MORNING = m(["hamstrings", "lower_back"], ["glute_max", "adductors"]);
const RACK_PULL = m(["lower_back", "glute_max"], ["back_upper_traps", "hamstrings"], ["back_lats", "forearm_flexors"]);

// Glúteo y lumbar
const HIP_THRUST = m(["glute_max"], ["hamstrings", "adductors"]);
const HIP_THRUST_SINGLE = m(["glute_max"], ["hamstrings", "glute_med"]);
const GLUTE_KICKBACK = m(["glute_max"], ["hamstrings"]);
const PULL_THROUGH = m(["glute_max"], ["hamstrings"]);
const GLUTE_HYPEREXTENSION = m(["glute_max"], ["hamstrings", "lower_back"]);
const BACK_HYPEREXTENSION = m(["lower_back"], ["glute_max", "hamstrings"]);
const BACK_EXTENSION_FLOOR = m(["lower_back"], ["glute_max"]);
const REVERSE_HYPER = m(["glute_max"], ["hamstrings", "lower_back"]);
const HIP_ABDUCTION = m(["glute_med"], ["glute_max"]);
const HIP_ADDUCTION = m(["adductors"]);

// Rodilla dominante
const SQUAT = m(["quads_vasti", "glute_max"], ["adductors"], ["lower_back", "abs_rectus"]);
const SQUAT_LOW_BAR = m(["glute_max", "quads_vasti"], ["adductors", "lower_back"], ["abs_rectus"]);
const SQUAT_BOX = m(["glute_max", "quads_vasti"], ["adductors", "hamstrings"], ["lower_back"]);
const SQUAT_FRONT = m(["quads_vasti"], ["glute_max", "adductors"], ["back_mid_traps", "abs_rectus"]);
const SQUAT_SUMO = m(["adductors", "glute_max"], ["quads_vasti"], ["lower_back"]);
const SQUAT_GOBLET = m(["quads_vasti"], ["glute_max", "adductors"], ["abs_rectus"]);
const SQUAT_MACHINE = m(["quads_vasti"], ["glute_max", "adductors"]);
const LEG_PRESS = m(["quads_vasti"], ["glute_max", "adductors"]);
const SPLIT_SQUAT = m(["quads_vasti", "glute_max"], ["adductors", "glute_med"]);
const STEP_UP = m(["quads_vasti", "glute_max"], ["glute_med"]);
const LEG_EXTENSION = m(["quads_rectus_femoris", "quads_vasti"]);
const SISSY_SQUAT = m(["quads_rectus_femoris", "quads_vasti"]);
const JUMP_SQUAT = m(["quads_vasti"], ["glute_max", "calves_gastrocnemius"]);

// Isquiosurales
const LEG_CURL = m(["hamstrings"]);
const NORDIC_CURL = m(["hamstrings"]);

// Gemelos y sóleo: de pie la rodilla está extendida y el gemelo manda;
// sentado, el gemelo queda acortado y trabaja casi solo el sóleo.
const CALF_STANDING = m(["calves_gastrocnemius"], ["calves_soleus"]);
const CALF_SEATED = m(["calves_soleus"]);

// Bíceps
const CURL = m(["biceps"], ["biceps_brachialis"], ["forearm_flexors"]);
const CURL_LENGTHENED = m(["biceps_long"], ["biceps_brachialis"]);
const CURL_SHORTENED = m(["biceps_short"], ["biceps_brachialis"]);
const CURL_HAMMER = m(["biceps_brachialis"], ["biceps"], ["forearm_flexors"]);
const CURL_REVERSE = m(["biceps_brachialis"], ["forearm_extensors", "biceps"]);

// Antebrazo
const WRIST_CURL = m(["forearm_flexors"]);
const REVERSE_WRIST_CURL = m(["forearm_extensors"]);
const DEAD_HANG = m(["forearm_flexors"], [], ["back_lats"]);
const FARMER_HOLD = m(["forearm_flexors"], [], ["back_upper_traps"]);

// Abdomen
const CRUNCH = m(["abs_rectus"], ["abs_obliques"]);
const OBLIQUE_CRUNCH = m(["abs_obliques"], ["abs_rectus"]);
const BICYCLE_CRUNCH = m(["abs_obliques", "abs_rectus"]);
const PLANK = m(["abs_rectus"], ["abs_obliques"]);
const SIDE_PLANK = m(["abs_obliques"], ["glute_med"]);
const COPENHAGEN_PLANK = m(["adductors", "abs_obliques"]);
const PALLOF_PRESS = m(["abs_obliques"], ["abs_rectus"]);
const AB_WHEEL = m(["abs_rectus"], ["abs_obliques"], ["back_lats", "triceps_long"]);

// Cardio y acondicionamiento: sin series de hipertrofia.
const CONDITIONING = m([]);

// --- Catálogo: nombre tal como está en BD → perfil ---
// La migración compara nombres sin tildes, mayúsculas ni espacios de más,
// así que las erratas del propio catálogo ("Sentadillla bulgara
// multipower") se escriben tal cual para que casen.
const CURATED = {
  // Pectoral
  "Press Banca": FLAT_PRESS,
  "Press banca en multipower": FLAT_PRESS,
  "Press mancuernas banco plano": FLAT_PRESS,
  "Press plano en máquina": FLAT_PRESS,
  "Press tumbado en máquina": FLAT_PRESS,
  "Press larsen": FLAT_PRESS,
  "Pin press": FLAT_PRESS,
  "Spoto press": FLAT_PRESS,
  "Press inclinado": INCLINE_PRESS,
  "Press inclinado con mancuernas": INCLINE_PRESS,
  "Press inclinado en multipower": INCLINE_PRESS,
  "Press inclinado máquina": INCLINE_PRESS,
  "Press landmine": LANDMINE_PRESS,
  "Press declinado": DECLINE_PRESS,
  "Press declinado con mancuernas": DECLINE_PRESS,
  "Press declinado en máquina": DECLINE_PRESS,
  "Press declinado en multipower": DECLINE_PRESS,
  "Press banca agarre cerrado": CLOSE_GRIP_PRESS,
  "Aperturas con mancuernas": FLAT_FLY,
  "Aperturas en máquina contractora": FLAT_FLY,
  "Aperturas con mancuernas banco inclinado": INCLINE_FLY,
  "Cruce poleas ascendente": INCLINE_FLY,
  "Cruce poleas descendente": DECLINE_FLY,
  "Svend press banco plano": SVEND_FLAT,
  "Svend press banco inclinado": SVEND_INCLINE,
  Flexiones: PUSHUP,
  "Flexiones rodillas apoyadas": PUSHUP,
  "Flexiones pies elevados": PUSHUP_FEET_UP,
  "Fondos en paralelas": CHEST_DIP,

  // Tríceps
  "Fondos paralelas tríceps": TRICEPS_DIP,
  "Fondos en máquina sentado": TRICEPS_DIP,
  "Fondos tríceps en banco": BENCH_DIP,
  "Kaz press": KAZ_PRESS,
  "Extensión de tríceps overhead con cuerda": TRICEPS_OVERHEAD,
  "Extensión de tríceps overhead mancuerna": TRICEPS_OVERHEAD,
  "Extensión de tríceps overhead mancuerna unilateral": TRICEPS_OVERHEAD,
  "Extensión overhead unilateral polea": TRICEPS_OVERHEAD,
  "Extensión de Tríceps con cuerda en polea alta": TRICEPS_PUSHDOWN,
  "Patada de tríceps mancuerna": TRICEPS_KICKBACK,
  "Patada de tríceps unilateral en polea": TRICEPS_KICKBACK,
  "Press francés barra Z": TRICEPS_SKULL,
  "Press francés mancuernas": TRICEPS_SKULL,
  "Dead french press": TRICEPS_SKULL,
  "Extensión de tríceps en máquina": TRICEPS_MACHINE,

  // Hombro
  "Press militar barra": OVERHEAD_PRESS_STANDING,
  "Press militar mancuerna": OVERHEAD_PRESS_SEATED,
  "Press militar en máquina": OVERHEAD_PRESS_SEATED,
  "Press militar multipower": OVERHEAD_PRESS_SEATED,
  "Press militar trasnuca": BEHIND_NECK_PRESS,
  "Press militar trasnuca multipower": BEHIND_NECK_PRESS,
  "Press arnold": ARNOLD_PRESS,
  "Push press con barra": PUSH_PRESS,
  "Push press con mancuernas": PUSH_PRESS,
  "Elevaciones laterales con mancuernas": LATERAL_RAISE,
  "Elevaciones laterales en máquina": LATERAL_RAISE,
  "Elevaciones laterales en polea": LATERAL_RAISE,
  "Elevaciones laterales sentado": LATERAL_RAISE,
  "Elevacion lateral banco inclinado": LATERAL_RAISE,
  "Elevaciones frontales con mancuernas": FRONT_RAISE,
  "Elevaciones frontales en polea": FRONT_RAISE,
  "Pájaros con mancuernas": REAR_DELT_FLY,
  "Pájaros con mancuernas banco inclinado": REAR_DELT_FLY,
  "Pájaros con mancuernas sentado": REAR_DELT_FLY,
  "Pájaros en máquina contractora": REAR_DELT_FLY,
  "Cruce posterior en poleas": REAR_DELT_FLY,
  "Hombro posterior en máquina": REAR_DELT_FLY,
  Facepull: FACE_PULL,
  "Remo al mentón": UPRIGHT_ROW,
  "Remo al menton multipower": UPRIGHT_ROW,

  // Espalda — verticales
  Dominadas: VERTICAL_PULL,
  "Máquina de dominadas asistidas": VERTICAL_PULL,
  "Jalón al pecho agarre prono": VERTICAL_PULL,
  "Jalón unilateral": VERTICAL_PULL,
  "Pull down máquina": VERTICAL_PULL,
  "Dominadas agarre neutro": VERTICAL_PULL_NEUTRAL,
  "Jalón al pecho agarre neutro": VERTICAL_PULL_NEUTRAL,
  "Jalón agarre cerrado": VERTICAL_PULL_NEUTRAL,
  "Dominadas agarre supino": VERTICAL_PULL_SUPINE,
  "Jalón al pecho agarre supino": VERTICAL_PULL_SUPINE,
  "Jalón trasnuca": BEHIND_NECK_PULLDOWN,
  "Pull over mancuerna": PULLOVER_DUMBBELL,
  "Pull over en polea": PULLOVER_CABLE,
  "Pull over máquina": PULLOVER_CABLE,

  // Espalda — remos
  "Bend over row": ROW_BENT_OVER,
  "Remo 45": ROW_BENT_OVER,
  "Remo 90": ROW_BENT_OVER,
  "Remo pendlay": ROW_BENT_OVER,
  "Remo en multipower": ROW_BENT_OVER,
  "Remo en punta": ROW_BENT_OVER,
  "Remo en T": ROW_BENT_OVER,
  "Remo 45 agarre supino": ROW_BENT_SUPINE,
  "Remo meadows": ROW_MEADOWS,
  "Remo con mancuerna unilateral": ROW_LATS,
  "Remo en gironda unilateral": ROW_LATS,
  "Remo gironda": ROW_LATS,
  "Remo en polea baja": ROW_LATS,
  "Remo unilateral polea": ROW_LATS,
  "Remo horizontal banco polea unilateral": ROW_LATS,
  "Jalón polea unilateral banco inclinado": ROW_LATS,
  "Remo gironda agarre supino": ROW_LATS_SUPINE,
  "Remo gironda agarre prono": ROW_WIDE,
  "Remo con mancuernas apoyado en banco inclinado": ROW_CHEST_SUPPORTED,
  "Seal row": ROW_CHEST_SUPPORTED,
  "Seal row banco inclinado mancuernas": ROW_CHEST_SUPPORTED,
  "Remo máquina": ROW_MACHINE,
  "Remo bajo en máquina": ROW_MACHINE,
  "Remo alto en máquina": ROW_HIGH_MACHINE,
  "Remo con peso corporal": ROW_INVERTED,
  "Remo en trx": ROW_INVERTED,
  // En BD figuraba como glúteo; por nombre es una máquina de espalda alta.
  "Upper back": UPPER_BACK_MACHINE,
  Encogimientos: SHRUG,

  // Bisagra de cadera
  "Peso muerto": DEADLIFT,
  "Peso muerto con parada": DEADLIFT,
  "Peso muerto en déficit de altura": DEADLIFT,
  "Peso muerto barra hexagonal": DEADLIFT_TRAP_BAR,
  "Peso muerto sumo": DEADLIFT_SUMO,
  "Peso muerto rumano": ROMANIAN_DEADLIFT,
  "Peso muerto rumano mancuernas": ROMANIAN_DEADLIFT,
  "Peso muerto rumano en multipower": ROMANIAN_DEADLIFT,
  "Peso muerto rumano barra hexagonal": ROMANIAN_DEADLIFT,
  "Peso muerto piernas rígidas": ROMANIAN_DEADLIFT,
  "Peso muerto rumano piernas rígidas": ROMANIAN_DEADLIFT,
  "Peso muerto rumano piernas rígidas mancuernas": ROMANIAN_DEADLIFT,
  "Peso muerto rumano unilateral": ROMANIAN_DEADLIFT_SINGLE,
  "Buenos días con barra": GOOD_MORNING,
  "Buenos días en multipower": GOOD_MORNING,
  "Rack pull": RACK_PULL,

  // Glúteo y lumbar
  "Hip thrust": HIP_THRUST,
  "Hip thrust máquina": HIP_THRUST,
  "Puente de glúteo": HIP_THRUST,
  "Hip thrust unilateral": HIP_THRUST_SINGLE,
  "Puente de glúteo unilateral": HIP_THRUST_SINGLE,
  "Patada de glúteo en multipower": GLUTE_KICKBACK,
  "Patada de glúteo máquina": GLUTE_KICKBACK,
  "Patada de glúteo polea": GLUTE_KICKBACK,
  "Patada de gúteo bilateral en multipower": GLUTE_KICKBACK,
  "Pull through": PULL_THROUGH,
  "HiperExtensiónes glúteo": GLUTE_HYPEREXTENSION,
  "HiperExtensión lumbar": BACK_HYPEREXTENSION,
  "Extensión lumbar en el suelo": BACK_EXTENSION_FLOOR,
  "Reverse hyper en banco": REVERSE_HYPER,
  "Abducción de pie en máquina": HIP_ABDUCTION,
  "Abductores en máquina": HIP_ABDUCTION,
  "Glúteo medio con banda elástica": HIP_ABDUCTION,
  "Glúteo medio en polea": HIP_ABDUCTION,
  "Aductores en máquina": HIP_ADDUCTION,

  // Rodilla dominante
  "Sentadilla barra alta": SQUAT,
  "Pin squat": SQUAT,
  "Sentadilla con barra safety": SQUAT,
  "Sentadilla barra baja": SQUAT_LOW_BAR,
  "Box squat": SQUAT_BOX,
  "Sentadilla Frontal": SQUAT_FRONT,
  "Sentadilla sumo": SQUAT_SUMO,
  "Sentadilla sumo multipower": SQUAT_SUMO,
  "Goblet squat": SQUAT_GOBLET,
  "Sentadilla hack": SQUAT_MACHINE,
  "Sentadilla multipower": SQUAT_MACHINE,
  "Sentadilla V": SQUAT_MACHINE,
  "Belt squat": SQUAT_MACHINE,
  "Prensa pendular": SQUAT_MACHINE,
  "Prensa 45": LEG_PRESS,
  "Prensa en máquina": LEG_PRESS,
  "Prensa vertical": LEG_PRESS,
  "Prensa unilateral": LEG_PRESS,
  "Sentadilla búlgara": SPLIT_SQUAT,
  "Sentadillla bulgara multipower": SPLIT_SQUAT,
  Zancadas: SPLIT_SQUAT,
  "Zancadas con barra": SPLIT_SQUAT,
  "Zancadas en multipower": SPLIT_SQUAT,
  "Step ups": STEP_UP,
  "Extensión de Cuádriceps": LEG_EXTENSION,
  "Sissy squat": SISSY_SQUAT,
  // En BD figuraba como glúteo: es una sissy guiada, cuádriceps puro.
  "Sentadilla sissy en máquina": SISSY_SQUAT,
  "Sentadillas con salto": JUMP_SQUAT,

  // Isquiosurales
  "Curl femoral de pie": LEG_CURL,
  "Curl femoral sentado": LEG_CURL,
  "Curl femoral tumbado": LEG_CURL,
  "Curl nordico": NORDIC_CURL,

  // Gemelos y sóleo
  "Gemelo en máquina de pie": CALF_STANDING,
  "Gemelo en multipower": CALF_STANDING,
  "Gemelo en prensa": CALF_STANDING,
  "Gemelos de pie con barra": CALF_STANDING,
  "Gemelo/soleo en máquina sentado": CALF_SEATED,

  // Bíceps
  "Curl 21": CURL,
  "Dead curl": CURL,
  "Curl bíceps barra": CURL,
  "Curl bíceps barra z": CURL,
  "Curl bíceps mancuernas": CURL,
  "Curl de bíceps alterno": CURL,
  "Curl de bíceps con barra en polea": CURL,
  "Curl de bíceps polea unilateral": CURL,
  "Curl bíceps tumbado polea": CURL,
  "Curl de bíceps en banco inclinado": CURL_LENGTHENED,
  "Curl bayesian": CURL_LENGTHENED,
  "Curl araña con barra": CURL_SHORTENED,
  "Curl araña con mancuernas": CURL_SHORTENED,
  "Curl concentrado": CURL_SHORTENED,
  "Curl en banco scott barra z": CURL_SHORTENED,
  "Curl en banco scott mancuerna unilateral": CURL_SHORTENED,
  "Curl predicador en máquina": CURL_SHORTENED,
  // Las máquinas de curl del catálogo son de tipo predicador.
  "Curl de bíceps en máquina": CURL_SHORTENED,
  "Curl en polea alta": CURL_SHORTENED,
  "Curl martillo": CURL_HAMMER,
  "Curl martillo polea": CURL_HAMMER,
  "Curl bíceps barra z agarre prono": CURL_REVERSE,
  "Curl de bíceps agarre prono polea": CURL_REVERSE,

  // Antebrazo
  "Curl supino antebrazo barra": WRIST_CURL,
  "Curl supino antebrazo mancuerna": WRIST_CURL,
  "Curl prono antebrazo barra": REVERSE_WRIST_CURL,
  "Curl prono antebrazo mancuerna": REVERSE_WRIST_CURL,
  "Aguantar colgado en barra": DEAD_HANG,
  "Sostener mancuernas": FARMER_HOLD,

  // Abdomen
  "Crunch abdominal": CRUNCH,
  "Crunch abdominal en máquina": CRUNCH,
  "Crunch en polea": CRUNCH,
  "Crunch invertido": CRUNCH,
  "Crunch oblicuos": OBLIQUE_CRUNCH,
  // En BD figuraba como espalda.
  "Oblicuos en máquina": OBLIQUE_CRUNCH,
  "Abdominales bicicleta": BICYCLE_CRUNCH,
  Plancha: PLANK,
  "Plancha lateral oblicuos": SIDE_PLANK,
  "Plancha lateral aductor": COPENHAGEN_PLANK,
  "Press pallof": PALLOF_PRESS,
  "Rueda abdominal": AB_WHEEL,

  // Cardio y acondicionamiento
  AirBike: CONDITIONING,
  Bici: CONDITIONING,
  "Bici estatica": CONDITIONING,
  "Bicicleta elíptica": CONDITIONING,
  "Botar pelota medicinal": CONDITIONING,
  Burpees: CONDITIONING,
  "Butt kicks": CONDITIONING,
  Cinta: CONDITIONING,
  Correr: CONDITIONING,
  "Desplazamientos laterales": CONDITIONING,
  "Empujar cajón": CONDITIONING,
  "Golpear al saco": CONDITIONING,
  "Jumping jacks": CONDITIONING,
  "Máquina de escaleras o stepper": CONDITIONING,
  "Mountain climbers": CONDITIONING,
  "Rope training": CONDITIONING,
  "Rowerg o máquina de Remo": CONDITIONING,
  "Saltar a la comba": CONDITIONING,
  "Salto al cajón": CONDITIONING,
  Skierg: CONDITIONING,
  "Skipping o elevación de rodillas": CONDITIONING,
  Trotar: CONDITIONING,
};

// --- Ejercicios propios de entrenadores en PRO sin músculos asignados ---
// Revisados a mano sobre la copia de PRO del 2026-09-28. Solo se aplican a
// ejercicios con userId y SIN muscleGroups1/2: si el entrenador marcó algo,
// manda su criterio.
const CURATED_USER = {
  "Recline Curl": CURL_LENGTHENED,
  "Curl supino mancuerna": CURL,
  "Curl concentrado polea baja": CURL_SHORTENED,
  "Press pecho polea lateral": FLAT_PRESS,
  "Press Pecho convergente": FLAT_PRESS,
  "Press plano en multipower": FLAT_PRESS,
  // Máquina Precor con el nombre de la porción que busca: la clavicular.
  "press precor haz clavicular": INCLINE_PRESS,
  // Aducción con el brazo bajando hacia la cadera: fibras costales.
  "aduccion costal": DECLINE_FLY,
  "Jalón polea sentado": VERTICAL_PULL,
  "Seated row (Dorsales)": ROW_LATS,
  "Reverse peck deck": REAR_DELT_FLY,
  // Portugués: elevaciones laterales en máquina y en polea baja.
  "Elevaçōes em máquina": LATERAL_RAISE,
  "Elevaçōes em polia baixa desde adiante": LATERAL_RAISE,
  "Extensión tríceps bilaterales en polea": TRICEPS_PUSHDOWN,
  "extensión tríceps agarre triangular": TRICEPS_PUSHDOWN,
  "Extensión de tríceps con barra": TRICEPS_SKULL,
  Sentadilla: SQUAT,
  "Sentadilla pesada": SQUAT,
  "sentadilla pendular": SQUAT_MACHINE,
  // MP = multipower.
  "Zancada MP": SPLIT_SQUAT,
  "Curl isquios": LEG_CURL,
  "Puente gluteo máquina": HIP_THRUST,
  "Gluteo medio": HIP_ABDUCTION,
  Gemelos: CALF_STANDING,
  "Crunch en polea de pie": CRUNCH,
  "Polea abdomi-anal": CRUNCH,
  // Deslizamientos sobre papel en el suelo: sea cual sea la variante, es
  // antiextensión de tronco, el mismo reparto que una plancha.
  "Papel abdominal": PLANK,
  // Movilidad y prevención: no son trabajo de hipertrofia. El tibial
  // anterior no tiene grupo propio a propósito: con un rango de 10-20
  // series saldría siempre en rojo por un trabajo que nadie programa por
  // volumen.
  "Movilidad tobillo": CONDITIONING,
  "Elevaciones tibial anterior": CONDITIONING,
};

module.exports = { CURATED, CURATED_USER };
