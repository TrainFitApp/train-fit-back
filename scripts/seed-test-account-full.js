const path = require("path");
const { customKeyFor } = require("../components/forms/custom-question");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const crypto = require("crypto");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
const { buildSearchFields } = require("../components/util/search-index");
const { isoDate, addDaysToIsoDate, startOfIsoWeek } = require("../components/util/date-util");
const { buildWeeks, weekAt } = require("../components/dietPhases/week-window");
const { deriveSuitability } = require("../components/dietTemplates/diet-suitability");
const { contentMacroProfile } = require("../components/dietTemplates/diet-macro-profile");
const { explainNutritionTarget } = require("../components/nutritionalGoals/nutrition-target");
const { stepsRangeFromValue, trainingDaysFromFactors } = require("../components/nutritionalGoals/training-factor");
const { CHECKIN_FIELDS_BY_KEY } = require("../components/trainerCheckins/checkin-field-catalog");
const { occurrenceDatesBetween } = require("../components/trainerCheckins/checkin-schedule-dates");
const { validateAnswers } = require("../components/trainerCheckins/checkin-agenda-service");

/**
 * DATOS DE PRUEBA COMPLETOS para las cuentas t@t.t (entrenador) y u@u.u
 * (cliente): dietas de biblioteca, fases de dieta ya asignadas con semanas,
 * días de dieta con cumplimiento, check-ins (plantillas, programaciones y
 * respuestas), antropometría, rutina con historial, hábitos, dolor,
 * suplementos, notas, cobros, historial de cambios y pendientes.
 *
 * Corre contra `pre` (Atlas compartido), así que:
 *   - NO crea cuentas: busca a las dos por email y aborta si falta alguna.
 *   - Es ADITIVO: no modifica ni borra nada que ya tuvieran (programaciones,
 *     hábito de pasos, suplementos, objetivo, preferencias...).
 *   - Todo lleva _id DETERMINISTA (índices relativos a "esta semana"), así
 *     que repetirlo reescribe los mismos documentos y `--clean` borra
 *     exactamente lo sembrado.
 *   - Las fechas son relativas a hoy: la fase actual siempre está en su
 *     semana 5, la programación semanal tiene su check-in de esta semana
 *     abierto, etc.
 *
 * USO
 *   node scripts/seed-test-account-full.js --dry-run   valida todo, no escribe
 *   node scripts/seed-test-account-full.js             siembra
 *   node scripts/seed-test-account-full.js --clean     borra lo sembrado
 */

const DRY = process.argv.includes("--dry-run");
const CLEAN = process.argv.includes("--clean");
const TRAINER_EMAIL = "t@t.t";
const CLIENT_EMAIL = "u@u.u";

function oid(seed) {
  const hex = crypto.createHash("md5").update("tf-full:" + seed).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}
function rnd(seed) {
  return parseInt(crypto.createHash("md5").update("r:" + seed).digest("hex").slice(0, 8), 16) / 0xffffffff;
}
const round1 = (n) => Math.round(n * 10) / 10;

// --- Calendario relativo a hoy ---------------------------------------------
const TODAY = isoDate(new Date());
const MON0 = startOfIsoWeek(TODAY); // lunes de esta semana
const d = (offset) => addDaysToIsoDate(MON0, offset);
const P1_START = d(-70);
const P2_START = d(-28);
const P1_END = d(-29);
const W3_START = d(-14);
const at = (date, hhmm = "09:00") => new Date(`${date}T${hhmm}:00.000Z`);

// --- Operaciones: [modelo, _id, documento] ---------------------------------
const ops = [];
const add = (model, id, doc) => ops.push({ model, _id: id, doc });

// ---------------------------------------------------------------------------
// ALIMENTOS (macros reales por 100 g, marcados con sus flags dietéticos)
// ---------------------------------------------------------------------------
const FLAGS = {
  MEAT: { vegan: false, vegetarian: false, lactoseFree: true, glutenFree: true },
  EGG: { vegan: false, vegetarian: true, lactoseFree: true, glutenFree: true },
  DAIRY: { vegan: false, vegetarian: true, lactoseFree: false, glutenFree: true },
  GLUTEN: { vegan: true, vegetarian: true, lactoseFree: true, glutenFree: false },
  PLANT: { vegan: true, vegetarian: true, lactoseFree: true, glutenFree: true },
};
// nombre: [kcal, proteína, hidratos, grasa, fibra, flags]
const FOOD_TABLE = {
  "Pechuga de pollo": [165, 31, 0, 3.6, 0, "MEAT"],
  "Pavo": [135, 29, 0, 1.7, 0, "MEAT"],
  "Ternera magra": [158, 26, 0, 5.4, 0, "MEAT"],
  "Merluza": [86, 17.2, 0, 1.8, 0, "MEAT"],
  "Salmón": [208, 20, 0, 13.4, 0, "MEAT"],
  "Atún al natural": [116, 26, 0, 1, 0, "MEAT"],
  "Huevo entero": [143, 12.6, 0.7, 9.5, 0, "EGG"],
  "Claras de huevo": [52, 10.9, 0.7, 0.2, 0, "EGG"],
  "Yogur griego natural": [97, 9, 3.6, 5, 0, "DAIRY"],
  "Queso fresco batido 0%": [47, 8, 3.9, 0.2, 0, "DAIRY"],
  "Leche desnatada": [35, 3.4, 4.9, 0.1, 0, "DAIRY"],
  "Proteína de suero": [380, 80, 6, 5, 0, "DAIRY"],
  "Avena en copos": [389, 16.9, 66.3, 6.9, 10.6, "GLUTEN"],
  "Pan integral": [247, 9.7, 41, 3.4, 7, "GLUTEN"],
  "Pasta integral": [348, 13, 66, 2.5, 8, "GLUTEN"],
  "Arroz basmati": [360, 7.5, 79, 0.9, 1.3, "PLANT"],
  "Arroz integral": [350, 7.9, 74, 2.9, 3.5, "PLANT"],
  "Patata": [77, 2, 17.5, 0.1, 2.2, "PLANT"],
  "Boniato": [86, 1.6, 20.1, 0.1, 3, "PLANT"],
  "Quinoa": [368, 14.1, 64.2, 6.1, 7, "PLANT"],
  "Lentejas cocidas": [116, 9, 20.1, 0.4, 7.9, "PLANT"],
  "Garbanzos cocidos": [139, 8.9, 22.5, 2.6, 7.6, "PLANT"],
  "Tofu firme": [144, 15.7, 2.8, 8.7, 1, "PLANT"],
  "Hummus": [166, 8, 14, 9.6, 6, "PLANT"],
  "Bebida de soja": [33, 3.3, 0.6, 1.8, 0.5, "PLANT"],
  "Aceite de oliva virgen extra": [884, 0, 0, 100, 0, "PLANT"],
  "Almendras": [579, 21.2, 21.6, 49.9, 12.5, "PLANT"],
  "Aguacate": [160, 2, 8.5, 14.7, 6.7, "PLANT"],
  "Brócoli": [34, 2.8, 6.6, 0.4, 2.6, "PLANT"],
  "Espinacas": [23, 2.9, 3.6, 0.4, 2.2, "PLANT"],
  "Tomate": [18, 0.9, 3.9, 0.2, 1.2, "PLANT"],
  "Calabacín": [17, 1.2, 3.1, 0.3, 1, "PLANT"],
  "Plátano": [89, 1.1, 22.8, 0.3, 2.6, "PLANT"],
  "Manzana": [52, 0.3, 13.8, 0.2, 2.4, "PLANT"],
  "Arándanos": [57, 0.7, 14.5, 0.3, 2.4, "PLANT"],
  "Dátiles": [282, 2.5, 75, 0.4, 8, "PLANT"],
};
let TRAINER_ID = null;
let CLIENT_ID = null;
const FOODS = {}; // nombre -> {id, kcal, ..., doc}
function buildFoods() {
  for (const [name, [kcal, p, c, f, fiber, flag]] of Object.entries(FOOD_TABLE)) {
    const id = oid("product:" + name);
    const doc = {
      name,
      userId: TRAINER_ID,
      energyKcal100g: kcal,
      protein100g: p,
      carbohydrates100g: c,
      fat100g: f,
      fiber100g: fiber,
      ...FLAGS[flag],
      ...buildSearchFields({ name }),
    };
    FOODS[name] = { id, kcal, doc };
    add("Product", id, doc);
  }
}

// ---------------------------------------------------------------------------
// Alternativas nominales de comida (cantidades en g antes de ajustar a kcal)
// ---------------------------------------------------------------------------
const ALT = {
  // desayunos
  dOat: ["Avena con leche y fruta", [["Avena en copos", 80], ["Leche desnatada", 250], ["Plátano", 120], ["Arándanos", 60]]],
  dEgg: ["Tostadas con huevo y aguacate", [["Huevo entero", 120], ["Pan integral", 100], ["Aguacate", 40], ["Tomate", 80]]],
  dYog: ["Yogur con avena", [["Yogur griego natural", 200], ["Avena en copos", 60], ["Plátano", 100]]],
  dSoy: ["Avena con soja y dátiles", [["Bebida de soja", 250], ["Avena en copos", 80], ["Plátano", 120], ["Dátiles", 30]]],
  dTofu: ["Tostadas con tofu", [["Tofu firme", 150], ["Pan integral", 100], ["Aguacate", 50], ["Tomate", 80]]],
  // comidas
  cChicken: ["Pollo con arroz", [["Pechuga de pollo", 180], ["Arroz basmati", 90], ["Brócoli", 150], ["Aceite de oliva virgen extra", 8]]],
  cChickenZ: ["Pollo con arroz y calabacín", [["Pechuga de pollo", 180], ["Arroz basmati", 90], ["Calabacín", 150], ["Aceite de oliva virgen extra", 8]]],
  cTurkey: ["Pavo con patata", [["Pavo", 180], ["Patata", 300], ["Calabacín", 150], ["Aceite de oliva virgen extra", 8]]],
  cBeef: ["Ternera con pasta", [["Ternera magra", 160], ["Pasta integral", 100], ["Tomate", 150], ["Aceite de oliva virgen extra", 8]]],
  cLentil: ["Lentejas con arroz", [["Lentejas cocidas", 300], ["Arroz integral", 60], ["Tomate", 100], ["Aceite de oliva virgen extra", 10]]],
  cChickpea: ["Garbanzos con quinoa", [["Garbanzos cocidos", 250], ["Quinoa", 60], ["Espinacas", 100], ["Aceite de oliva virgen extra", 10]]],
  cTofuRice: ["Tofu con arroz", [["Tofu firme", 200], ["Arroz basmati", 90], ["Calabacín", 150], ["Aceite de oliva virgen extra", 8]]],
  cEggRice: ["Huevos con arroz y queso", [["Huevo entero", 120], ["Arroz basmati", 90], ["Tomate", 120], ["Queso fresco batido 0%", 100], ["Aceite de oliva virgen extra", 8]]],
  // meriendas
  mYog: ["Yogur con plátano", [["Yogur griego natural", 170], ["Plátano", 100]]],
  mWhey: ["Batido de proteína", [["Proteína de suero", 30], ["Leche desnatada", 250], ["Manzana", 150]]],
  mHummus: ["Hummus con pan", [["Hummus", 80], ["Pan integral", 60], ["Manzana", 100]]],
  mFruit: ["Fruta y dátiles", [["Plátano", 120], ["Manzana", 150], ["Dátiles", 30]]],
  // cenas
  nFish: ["Merluza con patata", [["Merluza", 200], ["Patata", 300], ["Espinacas", 120], ["Aceite de oliva virgen extra", 8]]],
  nSalmon: ["Salmón con arroz", [["Salmón", 150], ["Arroz basmati", 80], ["Brócoli", 150]]],
  nOmelet: ["Tortilla con patata", [["Huevo entero", 150], ["Claras de huevo", 150], ["Patata", 250], ["Calabacín", 120], ["Aceite de oliva virgen extra", 6]]],
  nTuna: ["Pasta con atún", [["Atún al natural", 150], ["Pasta integral", 90], ["Tomate", 100], ["Aguacate", 40]]],
  nLentil: ["Crema de lentejas", [["Lentejas cocidas", 300], ["Patata", 200], ["Espinacas", 100], ["Aceite de oliva virgen extra", 8]]],
  nTofu: ["Tofu salteado con arroz", [["Tofu firme", 200], ["Arroz integral", 90], ["Calabacín", 150], ["Aceite de oliva virgen extra", 8]]],
  // recenas
  rYog: ["Queso batido con arándanos", [["Queso fresco batido 0%", 200], ["Arándanos", 60]]],
  rSoy: ["Soja con avena", [["Bebida de soja", 250], ["Avena en copos", 40]]],
};

const kcalOfItems = (items) => items.reduce((s, i) => s + (FOODS[i.food].kcal * i.qty) / 100, 0);
function sizeAlt(key, kcalTarget, withLabel) {
  const [label, nominal] = ALT[key];
  const items = nominal.map(([food, qty]) => ({ food, qty }));
  const f = kcalTarget / kcalOfItems(items);
  return {
    label: withLabel ? label : "",
    items: items.map((i) => ({ food: i.food, qty: Math.max(5, Math.round((i.qty * f) / 5) * 5) })),
  };
}

const SHARES = {
  train: { Desayuno: 0.24, Comida: 0.32, Merienda: 0.14, Cena: 0.22, Recena: 0.08 },
  rest: { Desayuno: 0.27, Comida: 0.35, Merienda: 0.12, Cena: 0.26 },
};
/**
 * Un menú dimensionado a `kcal`. `slots` = {Desayuno:[claves], Comida:[...], ...};
 * una comida con 2+ claves tiene alternativas (el cliente elige).
 */
function menu(name, kcal, slots) {
  const shares = slots.Recena ? SHARES.train : SHARES.rest;
  return {
    name,
    meals: Object.entries(slots).map(([slot, keys]) => ({
      slot,
      alternatives: keys.map((k) => sizeAlt(k, kcal * shares[slot], keys.length > 1)),
    })),
  };
}

// Contenido "poblado" (con el producto dentro) para calcular aptitud y macros
// con las mismas funciones puras que usa el back.
const populate = (menus) =>
  menus.map((m) => ({
    name: m.name,
    meals: m.meals.map((ml) => ({
      slot: ml.slot,
      alternatives: ml.alternatives.map((a) => ({
        label: a.label,
        customProducts: a.items.map((it) => ({ quantity: it.qty, product: FOODS[it.food].doc })),
        customRecipes: [],
      })),
    })),
  }));

/** Menús con sus alimentos embebidos (ids estables para re-sembrar). */
function writeMenus(tag, menus) {
  return menus.map((m, mi) => ({
    name: m.name,
    meals: m.meals.map((ml, li) => ({
      slot: ml.slot,
      alternatives: ml.alternatives.map((a, ai) => ({
        label: a.label,
        customProducts: a.items.map((it, ii) => ({
          _id: oid(`cp:${tag}:${mi}:${li}:${ai}:${ii}`),
          product: FOODS[it.food].id,
          quantity: it.qty,
          order: ii,
        })),
        customRecipes: [],
      })),
    })),
  }));
}

// ---------------------------------------------------------------------------
// NECESIDAD del cliente (misma fórmula que usa el back para la fase)
// ---------------------------------------------------------------------------
function needFor(user, weightKg, weightDate, delta) {
  const birth = new Date(user.birth);
  const age = Math.floor((new Date(`${weightDate}T12:00:00`) - birth) / (1000 * 3600 * 24) / 365.25);
  const profileRange = stepsRangeFromValue(user.steps);
  const explained = explainNutritionTarget({
    weightKg,
    heightCm: user.height,
    age,
    sex: user.sex,
    activity: user.activity,
    steps: user.steps,
    training: user.training,
    objetiveKcalDelta: delta,
  });
  return {
    target: explained.target,
    snapshot: {
      computedAt: at(weightDate),
      inputs: {
        weightKg,
        weightFrom: "anthropometry",
        weightDate,
        heightCm: user.height,
        age,
        sex: user.sex,
        activity: user.activity,
        stepsValue: user.steps ?? null,
        stepsLabel: profileRange?.label || null,
        stepsRangeKey: profileRange?.key || null,
        stepsFrom: "profile",
        trainingValue: user.training ?? null,
        trainingDays: profileRange ? trainingDaysFromFactors(profileRange.value, user.training) : null,
        objetiveKcalDelta: delta,
        proteinPerKg: null,
        fatPerKg: null,
      },
      breakdown: explained.breakdown,
      target: explained.target,
    },
  };
}

// ---------------------------------------------------------------------------
// Series de peso y medidas (una por lunes desde P1_START; la de esta semana
// queda SIN responder para poder probar el check-in del cliente)
// ---------------------------------------------------------------------------
const WEIGHTS = [78.1, 78.0, 78.2, 78.0, 78.1, 78.0, 77.6, 77.1, 76.6, 76.1];
const WAIST = [86.0, 86.2, 85.9, 86.0, 85.8, 86.0, 85.5, 85.0, 84.6, 84.1];
const NAVEL = [91.0, 91.2, 90.8, 91.0, 90.9, 91.0, 90.4, 89.8, 89.3, 88.7];
const CHEST = [102.0, 102.1, 102.0, 102.3, 102.2, 102.4, 102.4, 102.6, 102.7, 102.9];
const HIP = [99.0, 99.1, 99.0, 98.9, 99.0, 98.9, 98.7, 98.5, 98.4, 98.2];

const weeklyWeekOffset = (i) => -70 + 7 * i; // offset del lunes i-ésimo

// Semanas de cada fase para sellar los check-ins
function weekStamp(date, phases) {
  for (const ph of phases) {
    if (date < ph.start || (ph.end && date > ph.end)) continue;
    const weeks = buildWeeks(ph.start, ph.end, TODAY);
    const w = weekAt(weeks, date);
    if (w) return { phaseId: ph.headId, number: w.number, start: w.start, end: w.end };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// NUTRICIÓN: biblioteca, fases y días
// ---------------------------------------------------------------------------
function buildNutrition(user) {
  const needP2 = needFor(user, WEIGHTS[6], P2_START, user.objetive ?? -300);
  const needP1 = needFor(user, WEIGHTS[0], P1_START, 0);
  const TGT = needP2.target.kcal;

  // --- Biblioteca de t@t.t ---
  const lib = [
    ["def", "Definición equilibrada", {}, [
      menu("Entrenamiento", TGT, { Desayuno: ["dOat"], Comida: ["cChicken"], Merienda: ["mYog"], Cena: ["nFish"], Recena: ["rYog"] }),
      menu("Descanso", TGT * 0.9, { Desayuno: ["dEgg"], Comida: ["cTurkey"], Merienda: ["mWhey"], Cena: ["nOmelet"] }),
    ]],
    ["pro", "Alta en proteína", {}, [
      menu("Entrenamiento", TGT * 1.02, { Desayuno: ["dEgg"], Comida: ["cBeef"], Merienda: ["mWhey"], Cena: ["nTuna"], Recena: ["rYog"] }),
      menu("Descanso", TGT * 0.92, { Desayuno: ["dYog"], Comida: ["cChicken"], Merienda: ["mWhey"], Cena: ["nSalmon"] }),
    ]],
    ["veg", "Vegetariana equilibrada", {}, [
      menu("Entrenamiento", TGT, { Desayuno: ["dYog"], Comida: ["cEggRice"], Merienda: ["mHummus"], Cena: ["nOmelet"], Recena: ["rYog"] }),
      menu("Descanso", TGT * 0.9, { Desayuno: ["dEgg"], Comida: ["cLentil"], Merienda: ["mYog"], Cena: ["nLentil"] }),
    ]],
    ["vgn", "Vegana flexible", {}, [
      menu("Entrenamiento", TGT * 0.95, { Desayuno: ["dSoy"], Comida: ["cTofuRice", "cChickpea"], Merienda: ["mFruit"], Cena: ["nTofu"], Recena: ["rSoy"] }),
      menu("Descanso", TGT * 0.85, { Desayuno: ["dTofu"], Comida: ["cLentil"], Merienda: ["mHummus"], Cena: ["nLentil"] }),
    ]],
    ["vol", "Volumen limpio", {}, [
      menu("Entrenamiento fuerte", TGT * 1.2, { Desayuno: ["dOat"], Comida: ["cBeef"], Merienda: ["mWhey"], Cena: ["nSalmon"], Recena: ["rYog"] }),
      menu("Entrenamiento ligero", TGT * 1.1, { Desayuno: ["dEgg"], Comida: ["cChicken"], Merienda: ["mYog"], Cena: ["nTuna"], Recena: ["rYog"] }),
      menu("Descanso", TGT * 1.0, { Desayuno: ["dYog"], Comida: ["cTurkey"], Merienda: ["mFruit"], Cena: ["nOmelet"] }),
    ]],
    ["flex", "Mantenimiento con opciones", {}, [
      menu("Entrenamiento", TGT * 1.08, { Desayuno: ["dOat", "dEgg"], Comida: ["cChicken", "cBeef", "cChickpea"], Merienda: ["mYog", "mFruit"], Cena: ["nFish", "nTuna"], Recena: ["rYog"] }),
      menu("Descanso", TGT * 0.98, { Desayuno: ["dYog", "dEgg"], Comida: ["cTurkey", "cLentil"], Merienda: ["mWhey", "mHummus"], Cena: ["nOmelet", "nSalmon"] }),
    ]],
    ["std", "Plan estándar TF (de fábrica)", { verified: true }, [
      menu("Día tipo", TGT, { Desayuno: ["dOat"], Comida: ["cChicken"], Merienda: ["mYog"], Cena: ["nFish"], Recena: ["rYog"] }),
    ]],
    ["own", "Dieta de Test User (huevos y legumbres)", { ownerClientId: CLIENT_ID }, [
      menu("Entrenamiento", TGT * 0.97, { Desayuno: ["dEgg"], Comida: ["cLentil"], Merienda: ["mYog"], Cena: ["nOmelet"], Recena: ["rYog"] }),
      menu("Descanso", TGT * 0.88, { Desayuno: ["dYog"], Comida: ["cEggRice"], Merienda: ["mHummus"], Cena: ["nLentil"] }),
    ]],
  ];
  const libStats = [];
  for (const [key, name, extra, menus] of lib) {
    const id = oid("tpl:" + key);
    const { suitableFor } = deriveSuitability({ menus: populate(menus) });
    add("DietTemplate", id, {
      trainerId: TRAINER_ID,
      name,
      menus: writeMenus("tpl:" + key, menus),
      suitableFor,
      suitableForOverride: [],
      createdAt: at(d(-80 + libStats.length)),
      ...extra,
    });
    libStats.push({ name, ...contentMacroProfile({ menus: populate(menus) }), suitableFor });
  }

  // --- Fases asignadas al cliente ---
  // Fase 1 "Adaptación" (mantenimiento): un documento, ya cerrada.
  const p1Menus = [
    menu("Entrenamiento", needP1.target.kcal, { Desayuno: ["dOat"], Comida: ["cChickenZ"], Merienda: ["mYog"], Cena: ["nFish"], Recena: ["rYog"] }),
    menu("Descanso", needP1.target.kcal * 0.92, { Desayuno: ["dEgg"], Comida: ["cTurkey"], Merienda: ["mWhey"], Cena: ["nOmelet"] }),
  ];
  const p1Id = oid("phase1:head");
  const p2Id = oid("phase2:head");
  const w3Id = oid("phase2:w3");

  // Fase 2 "Definición" vegetariana, sin frutos secos ni brócoli ni pescado
  // azul (lo que declara el cliente); comida y cena con alternativas.
  const p2Menus = [
    menu("Entrenamiento", needP2.target.kcal, { Desayuno: ["dYog"], Comida: ["cEggRice", "cLentil"], Merienda: ["mHummus"], Cena: ["nOmelet", "nLentil"], Recena: ["rYog"] }),
    menu("Descanso", needP2.target.kcal * 0.9, { Desayuno: ["dEgg"], Comida: ["cChickpea"], Merienda: ["mYog"], Cena: ["nLentil"] }),
  ];
  // Semana 3: el entrenador baja ~4 % las cantidades (pierde menos de lo previsto).
  const w3Menus = [
    menu("Entrenamiento", needP2.target.kcal * 0.96, { Desayuno: ["dYog"], Comida: ["cEggRice", "cLentil"], Merienda: ["mHummus"], Cena: ["nOmelet", "nLentil"], Recena: ["rYog"] }),
    menu("Descanso", needP2.target.kcal * 0.9 * 0.96, { Desayuno: ["dEgg"], Comida: ["cChickpea"], Merienda: ["mYog"], Cena: ["nLentil"] }),
  ];
  const common = { trainerId: TRAINER_ID, clientId: CLIENT_ID, proteinPerKg: null, fatPerKg: null };
  add("DietPhase", p1Id, {
    ...common,
    name: "Adaptación",
    sourceTemplateId: oid("tpl:def"),
    startDate: P1_START,
    endDate: P1_END,
    target: { ...needP1.target, source: "calculated" },
    need: needP1.snapshot,
    contents: [{ _id: oid("phase1:content1"), startDate: P1_START, menus: writeMenus("phase1", p1Menus) }],
    createdAt: at(P1_START),
  });
  add("DietPhase", p2Id, {
    ...common,
    name: "Definición",
    sourceTemplateId: oid("tpl:veg"),
    startDate: P2_START,
    endDate: null,
    target: { ...needP2.target, source: "calculated" },
    need: needP2.snapshot,
    contents: [
      { _id: oid("phase2:content1"), startDate: P2_START, menus: writeMenus("phase2", p2Menus) },
      // Semana 3 preparada con menos cantidad: otra versión dentro de la fase.
      { _id: w3Id, startDate: W3_START, menus: writeMenus("phase2w3", w3Menus) },
    ],
    createdAt: at(P2_START),
  });

  const contents = [
    { start: P1_START, end: P1_END, menus: p1Menus },
    { start: P2_START, end: addDaysToIsoDate(W3_START, -1), menus: p2Menus },
    { start: W3_START, end: null, menus: w3Menus },
  ];
  const phases = [
    { start: P1_START, end: P1_END, headId: p1Id },
    { start: P2_START, end: null, headId: p2Id },
  ];
  return { contents, phases, libStats, needP1, needP2 };
}

// Días de dieta del cliente con cumplimiento
const SKIPPED = new Set([-58, -12].map((o) => d(o)));
function buildDietDays(contents) {
  const SLOTS = ["Desayuno", "Almuerzo", "Comida", "Merienda", "Cena", "Recena"];
  let days = 0;
  let planned = 0;
  let consumed = 0;
  for (let k = 0, date = P1_START; date <= TODAY; k++, date = addDaysToIsoDate(P1_START, k)) {
    const content = contents.find((c) => date >= c.start && (!c.end || date <= c.end));
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
    const trains = [1, 2, 4, 5].includes(weekday);
    const menuName = trains ? "Entrenamiento" : "Descanso";
    const skipped = SKIPPED.has(date);
    const chosen = content && !skipped ? content.menus.find((m) => m.name === menuName) : null;
    const isPast = date < TODAY;
    // Cumplimiento: ~88 %, algo peor en la semana 3-4 de la fase 2 (déficit)
    const rate = date >= d(-14) && date < d(0) ? 0.74 : 0.9;

    const meals = [];
    SLOTS.forEach((slot, si) => {
      const mealId = oid(`meal:${k}:${si}`);
      const planMeal = chosen?.meals.find((m) => m.slot === slot);
      const cps = [];
      let alternatives = [];
      let chosenIdx = null;
      let allDone = false;

      if (planMeal && planMeal.alternatives.length) {
        const multi = planMeal.alternatives.length > 1;
        chosenIdx = multi ? (rnd(`alt:${k}:${si}`) < 0.3 ? 1 : 0) : null;
        const alt = planMeal.alternatives[chosenIdx ?? 0];
        if (multi) {
          alternatives = planMeal.alternatives.map((a) => ({
            label: a.label,
            customProducts: a.items.map((it) => ({ product: FOODS[it.food].id, quantity: it.qty })),
            customRecipes: [],
          }));
        }
        // Hoy solo se han comido las primeras comidas
        const eaten = isPast || si <= 1;
        let doneCount = 0;
        alt.items.forEach((it, ii) => {
          const ok = eaten && rnd(`c:${k}:${si}:${ii}`) < rate;
          const dev = ok && rnd(`q:${k}:${si}:${ii}`) < 0.2 ? 1 + (rnd(`qq:${k}:${si}:${ii}`) - 0.5) * 0.3 : 1;
          cps.push({
            _id: oid(`dcp:${k}:${si}:${ii}`),
            product: FOODS[it.food].id,
            mealId,
            quantity: Math.max(5, Math.round((it.qty * dev) / 5) * 5),
            order: ii,
            assignedByTrainerId: TRAINER_ID,
            assignedQuantity: it.qty,
            consumed: ok,
          });
          planned++;
          if (ok) {
            consumed++;
            doneCount++;
          }
        });
        allDone = eaten && doneCount === alt.items.length;
      }
      // Extras que añade el cliente por su cuenta (no cuentan como cumplimiento)
      if ((slot === "Merienda" || slot === "Recena") && isPast && !skipped && rnd(`x:${k}:${si}`) < 0.15) {
        cps.push({ _id: oid(`dcpx:${k}:${si}`), product: FOODS["Plátano"].id, mealId, quantity: 100, order: 9, consumed: true });
      }

      meals.push({
        _id: mealId,
        name: slot,
        customProducts: cps,
        customRecipes: [],
        completed: allDone,
        alternatives,
        chosenAlternativeIndex: chosenIdx,
        alternativesTrainerId: alternatives.length ? TRAINER_ID : null,
        createdAt: at(date, "07:00"),
      });
    });

    add("DietDay", oid(`dd:${k}`), {
      userId: CLIENT_ID,
      date,
      menuName: skipped ? null : content ? menuName : null,
      skipped,
      meals,
    });
    days++;
  }
  return { days, planned, consumed };
}

// ---------------------------------------------------------------------------
// CHECK-INS
// ---------------------------------------------------------------------------
const WEEKLY_FIELDS = [
  "weight", "perimeter_waist", "perimeter_navel", "perimeter_chest", "perimeter_hip",
  "recovery_between_sessions", "training_adherence", "hunger_satiety", "hydration_level",
  "stress_level", "motivation_level", "sleep_hours", "sleep_quality", "general_fatigue",
  "nutrition_plan_adherence", "urine_color", "comment",
];
const MONTHLY_FIELDS = [
  "weight", "muscle_mass", "fat_mass", "bone_mass", "residual_mass", "perimeter_neck", "perimeter_shoulders",
  "perimeter_chest", "perimeter_waist", "perimeter_navel", "perimeter_hip", "perimeter_bicep_relaxed_l",
  "perimeter_bicep_relaxed_r", "perimeter_bicep_flexed_l", "perimeter_bicep_flexed_r", "perimeter_quad_l",
  "perimeter_quad_r", "perimeter_thigh_relaxed", "perimeter_calf_l", "perimeter_calf_r", "comment",
];
const QUICK_FIELDS = ["recovery_between_sessions", "sleep_quality", "general_fatigue", "stress_level", "motivation_level", "comment"];

const Q = {
  meals: { _id: oid("q:meals"), label: "¿Cómo has llevado las comidas fuera de casa?", type: "select", options: ["Ninguna", "Una", "Dos o más"], required: false, enabled: true, unit: "" },
  knee: { _id: oid("q:knee"), label: "¿Cómo va la rodilla derecha?", type: "scale_1_5", options: [], required: false, enabled: true, unit: "" },
  km: { _id: oid("q:km"), label: "Km caminados esta semana", type: "number", unit: "km", options: [], required: false, enabled: true },
  sessions: { _id: oid("q:sessions"), label: "¿Has hecho todas las sesiones pautadas?", type: "yes_no", options: [], required: true, enabled: true, unit: "" },
  water: { _id: oid("q:water"), label: "¿Has cumplido el objetivo de agua?", type: "frequency", options: [], required: false, enabled: true, unit: "" },
  free: { _id: oid("q:free"), label: "¿Algo que quieras contarle a tu entrenador?", type: "text", options: [], required: false, enabled: true, unit: "" },
};
const ck = (q) => customKeyFor(q._id);

const COMMENTS = [
  "Primera semana, todo bien. Me cuesta acostumbrarme a pesar la comida.",
  "Semana normal, sin incidencias.",
  "Viaje de trabajo, comí fuera casi todos los días.",
  "Me noto con más energía en los entrenos.",
  "Buena semana, subí peso en press banca.",
  "Cierro la fase de adaptación. Ganas de empezar la definición.",
  "Empiezo definición. Algo de hambre por las noches.",
  "Duermo peor, pero cumplí el plan.",
  "Semana dura de trabajo. Cansancio acumulado.",
  "Mejor sensación, la ropa me queda más holgada.",
];
const OUT_MEALS = ["Ninguna", "Una", "Dos o más", "Ninguna", "Una"];
const FREQ = ["Siempre", "A menudo", "A veces", "A menudo", "Siempre"];

const clampScale = (v, max = 5) => Math.max(1, Math.min(max, Math.round(v)));

function weeklyValues(i) {
  const late = i >= 8; // semanas 3-4 de definición: más cansancio
  const values = {
    weight: WEIGHTS[i],
    perimeter_waist: WAIST[i],
    perimeter_navel: NAVEL[i],
    perimeter_chest: CHEST[i],
    perimeter_hip: HIP[i],
    recovery_between_sessions: clampScale(4 - (late ? 1 : 0) + (rnd(`w:r:${i}`) - 0.5) * 1.5),
    training_adherence: clampScale(4.5 + (rnd(`w:t:${i}`) - 0.5)),
    hunger_satiety: clampScale((i >= 6 ? 2.5 : 3.2) + (rnd(`w:h:${i}`) - 0.5)),
    hydration_level: clampScale(3.6 + (rnd(`w:hy:${i}`) - 0.5) * 1.5),
    stress_level: clampScale((late ? 3.6 : 2.4) + (rnd(`w:s:${i}`) - 0.5)),
    motivation_level: clampScale((late ? 3.4 : 4.2) + (rnd(`w:m:${i}`) - 0.5)),
    sleep_hours: round1(7.6 - (late ? 0.8 : 0) + (rnd(`w:sh:${i}`) - 0.5)),
    sleep_quality: clampScale((late ? 3 : 4) + (rnd(`w:sq:${i}`) - 0.5)),
    general_fatigue: clampScale((late ? 3.8 : 2.4) + (rnd(`w:f:${i}`) - 0.5)),
    nutrition_plan_adherence: clampScale((i < 6 ? 4.2 : 4.4) + (rnd(`w:n:${i}`) - 0.5)),
    urine_color: clampScale(2.8 + (rnd(`w:u:${i}`) - 0.5) * 2, 8),
    comment: COMMENTS[i],
    [ck(Q.meals)]: OUT_MEALS[i % 5],
    [ck(Q.knee)]: clampScale(2.2 + (rnd(`w:k:${i}`) - 0.5) * 2),
    [ck(Q.km)]: Math.round(28 + rnd(`w:km:${i}`) * 14),
    [ck(Q.sessions)]: rnd(`w:se:${i}`) < 0.8,
    [ck(Q.water)]: FREQ[i % 5],
    [ck(Q.free)]: i % 3 === 0 ? "Todo bien, sin dudas esta semana." : "Me gustaría cambiar la cena del jueves.",
  };
  return values;
}

function anthropometryFromValues(values) {
  const out = {};
  for (const [key, value] of Object.entries(values)) {
    const f = CHECKIN_FIELDS_BY_KEY.get(key);
    if (f?.storage === "anthropometry") out[f.anthropometryField] = value;
  }
  return out;
}

function buildCheckins(phases, existingAnthroDates) {
  const anthroByOffset = new Map(); // offset -> campos
  const addAnthro = (offset, fields) => anthroByOffset.set(offset, { ...(anthroByOffset.get(offset) || {}), ...fields });
  const stats = { responses: 0 };

  // --- Plantillas (formularios) ---
  const defs = {
    weekly: { id: oid("chkdef:weekly"), name: "Semanal completo", enabledFields: WEEKLY_FIELDS, requiredFields: ["weight"], customQuestions: Object.values(Q) },
    monthly: { id: oid("chkdef:monthly"), name: "Medidas mensuales", enabledFields: MONTHLY_FIELDS, requiredFields: ["weight"], customQuestions: [] },
    quick: { id: oid("chkdef:quick"), name: "Bienestar rápido", enabledFields: QUICK_FIELDS, requiredFields: [], customQuestions: [] },
  };
  for (const def of Object.values(defs)) {
    add("CheckinTemplateDefinition", def.id, {
      trainerId: TRAINER_ID,
      name: def.name,
      enabledFields: def.enabledFields,
      requiredFields: def.requiredFields,
      customQuestions: def.customQuestions,
      createdAt: at(d(-75)),
    });
  }

  const schedules = [
    { key: "weekly", def: defs.weekly, name: "Check-in semanal", startDate: P1_START, time: "08:00", frequency: "weekly", interval: 1, active: true, revision: 3 },
    { key: "monthly", def: defs.monthly, name: "Medidas mensuales", startDate: d(-66), time: "09:00", frequency: "monthly", interval: 1, active: true, revision: 1 },
    { key: "quick", def: defs.quick, name: "Bienestar diario (pausado)", startDate: d(-12), time: "20:00", frequency: "daily", interval: 1, active: false, revision: 2 },
    { key: "final", def: defs.quick, name: "Revisión final de fase", startDate: d(10), time: "09:00", frequency: "once", interval: 1, active: true, revision: 0 },
  ];
  const sched = {};
  for (const s of schedules) {
    const id = oid("chksch:" + s.key);
    sched[s.key] = { ...s, id };
    add("CheckinSchedule", id, {
      trainerId: TRAINER_ID,
      clientId: CLIENT_ID,
      name: s.name,
      sourceTemplateId: s.def.id,
      enabledFields: s.def.enabledFields,
      requiredFields: s.def.requiredFields,
      customQuestions: s.def.customQuestions,
      startDate: s.startDate,
      time: s.time,
      frequency: s.frequency,
      interval: s.interval,
      active: s.active,
      revision: s.revision,
      createdAt: at(addDaysToIsoDate(s.startDate, -2)),
      updatedAt: at(addDaysToIsoDate(s.startDate, -2)),
    });
  }

  const respond = (s, idx, date, values, extra = {}) => {
    const schedLike = { enabledFields: s.def.enabledFields, requiredFields: s.def.requiredFields, customQuestions: s.def.customQuestions };
    const v = validateAnswers(schedLike, values);
    if (v.error) throw new Error(`Check-in ${s.key} ${date}: ${v.error}`);
    const respondedAt = at(date, "0" + (8 + (idx % 2)) + ":" + (10 + ((idx * 7) % 40)));
    add("CheckinResponse", oid(`chkres:${s.key}:${idx}`), {
      trainerId: TRAINER_ID,
      clientId: CLIENT_ID,
      scheduleId: s.id,
      occurrenceDate: date,
      name: s.name,
      enabledFields: s.def.enabledFields,
      requiredFields: s.def.requiredFields,
      customQuestions: s.def.customQuestions,
      values: v.values,
      respondedAt,
      updatedAt: extra.updatedAt || respondedAt,
      status: extra.status || "responded",
      reviewedAt: extra.reviewedAt || null,
      reviewComment: extra.reviewComment || "",
      week: weekStamp(date, phases),
    });
    stats.responses++;
    addAnthro(Math.round((Date.parse(date) - Date.parse(MON0)) / 86400000), anthropometryFromValues(v.values));
  };

  // Semanal: 10 lunes con respuesta salvo el 3.º (perdido); el 11.º (esta semana) abierto
  const REVIEW = {
    0: "Buen punto de partida. Sigue pesándote siempre en las mismas condiciones.",
    1: "",
    3: "Vas muy bien de adherencia. Mantenemos.",
    5: "Cerramos adaptación. Pasamos a definición con -300 kcal.",
    6: "Semana 1 de definición: hambre normal. Aumenta la verdura en la cena.",
    7: "Peso bajando al ritmo previsto.",
  };
  for (let i = 0; i <= 9; i++) {
    if (i === 2) continue; // check-in perdido
    const date = d(weeklyWeekOffset(i));
    const reviewed = i in REVIEW;
    respond(sched.weekly, i, date, weeklyValues(i), {
      status: reviewed ? "reviewed" : "responded",
      reviewedAt: reviewed ? at(addDaysToIsoDate(date, 1), "10:30") : null,
      reviewComment: REVIEW[i] || "",
      updatedAt: i === 9 ? at(addDaysToIsoDate(date, 1), "21:05") : undefined,
    });
  }

  // Mensual: las ocurrencias ya cerradas, respondidas; la abierta, sin responder
  const monthly = occurrenceDatesBetween(sched.monthly, sched.monthly.startDate, TODAY);
  monthly.forEach((occ, idx) => {
    const closed = occ.next && occ.next <= TODAY;
    if (!closed) return;
    const w = WEIGHTS[Math.min(9, Math.max(0, Math.round((Date.parse(occ.date) - Date.parse(P1_START)) / 86400000 / 7)))];
    respond(sched.monthly, idx, occ.date, {
      weight: w,
      muscle_mass: round1(w * 0.44 + idx * 0.2),
      fat_mass: round1(w * 0.19 - idx * 0.6),
      bone_mass: 3.4,
      residual_mass: round1(w * 0.27),
      perimeter_neck: 38,
      perimeter_shoulders: 118,
      perimeter_chest: 102.2 + idx * 0.3,
      perimeter_waist: 86 - idx * 0.7,
      perimeter_navel: 91 - idx * 0.8,
      perimeter_hip: 99 - idx * 0.3,
      perimeter_bicep_relaxed_l: 34.2 + idx * 0.2,
      perimeter_bicep_relaxed_r: 34.6 + idx * 0.2,
      perimeter_bicep_flexed_l: 38 + idx * 0.2,
      perimeter_bicep_flexed_r: 38.4 + idx * 0.2,
      perimeter_quad_l: 59.5,
      perimeter_quad_r: 60,
      perimeter_thigh_relaxed: 62,
      perimeter_calf_l: 38.5,
      perimeter_calf_r: 38.7,
      comment: idx === 0 ? "Medidas de inicio con cinta en las mismas marcas." : "Medidas del mes.",
    }, { status: "reviewed", reviewedAt: at(addDaysToIsoDate(occ.date, 2), "12:00"), reviewComment: idx === 0 ? "Referencia inicial guardada." : "Buen progreso en cintura." });
  });

  // Pausado: 5 respuestas diarias antes de pausarlo
  for (let i = 0; i < 5; i++) {
    const values = {
      recovery_between_sessions: 3 + (i % 2),
      sleep_quality: 3 + ((i + 1) % 2),
      general_fatigue: 2 + (i % 3),
      stress_level: 2 + (i % 2),
      motivation_level: 4,
    };
    if (i === 4) values.comment = "Lo pauso, me agobia el diario.";
    respond(sched.quick, i, addDaysToIsoDate(sched.quick.startDate, i), values);
  }

  // Antropometría derivada (una fila por fecha, sin pisar las que ya tenían)
  let skipped = 0;
  for (const [offset, fields] of anthroByOffset) {
    const date = d(offset);
    if (existingAnthroDates.has(date)) {
      skipped++;
      continue;
    }
    add("Anthropometry", oid("anth:" + offset), { userId: CLIENT_ID, date, ...fields });
  }
  return { ...stats, anthroRows: anthroByOffset.size - skipped, anthroSkipped: skipped };
}

// ---------------------------------------------------------------------------
// ENTRENAMIENTO
// ---------------------------------------------------------------------------
// nombre catálogo, series, reps esperadas, peso base (kg), descanso, músculos, articulaciones
const SESSIONS = [
  { name: "Torso A", dow: 0, ex: [
    ["Press banca", 4, [6, 8], 70, 150, [["Pectoral", 3], ["Tríceps", 2], ["Deltoides anterior", 2]], [["Hombro", 2], ["Codo", 1]]],
    ["Remo gironda", 4, [8, 10], 60, 120, [["Espalda alta", 3], ["Bíceps", 2], ["Deltoides posterior", 1]], [["Codo", 1], ["Hombro", 1]]],
    ["Press militar mancuerna", 3, [8, 10], 22, 120, [["Deltoides anterior", 3], ["Tríceps", 2]], [["Hombro", 3], ["Codo", 1]]],
    ["Curl bíceps barra z", 3, [10, 12], 30, 90, [["Bíceps", 3]], [["Codo", 2]]],
  ] },
  { name: "Pierna A", dow: 2, ex: [
    ["Sentadilla barra alta", 4, [6, 8], 90, 180, [["Cuádriceps", 3], ["Glúteo", 3], ["Femoral", 1]], [["Rodilla", 3], ["Cadera", 2]]],
    ["Peso muerto rumano", 4, [8, 10], 90, 150, [["Femoral", 3], ["Glúteo", 3], ["Espalda baja", 2]], [["Columna lumbar", 3], ["Cadera", 2]]],
    ["Curl femoral tumbado", 3, [10, 12], 40, 90, [["Femoral", 3]], [["Rodilla", 1]]],
    ["Gemelo en prensa", 4, [12, 15], 100, 60, [["Gemelo", 3]], [["Tobillo", 2]]],
  ] },
  { name: "Torso B", dow: 4, ex: [
    ["Press inclinado con mancuernas", 4, [8, 10], 26, 120, [["Pectoral", 3], ["Deltoides anterior", 2], ["Tríceps", 1]], [["Hombro", 2], ["Codo", 1]]],
    ["Jalón agarre cerrado", 4, [8, 10], 60, 120, [["Espalda alta", 3], ["Bíceps", 2]], [["Hombro", 1], ["Codo", 1]]],
    ["Elevaciones laterales sentado", 3, [12, 15], 10, 60, [["Deltoides lateral", 3]], [["Hombro", 2]]],
    ["Press francés mancuernas", 3, [10, 12], 22, 90, [["Tríceps", 3]], [["Codo", 3]]],
  ] },
];
const MICROS = [
  { name: "Semana 1 · Base", purpose: "accumulation", objective: "Aprender técnica y fijar cargas de trabajo.", factor: 1, sets: 1 },
  { name: "Semana 2 · Acumulación", purpose: "accumulation", objective: "Subir 2,5 kg en los básicos manteniendo técnica.", factor: 1.03, sets: 1 },
  { name: "Semana 3 · Intensificación", purpose: "intensification", objective: "Menos series, más carga. RIR 1 en la última.", factor: 1.06, sets: 1 },
  { name: "Semana 4 · Descarga", purpose: "deload", objective: "Bajar volumen a la mitad. Llegar fresco al siguiente bloque.", factor: 0.9, sets: 0.5 },
];

function buildTraining(exerciseIds) {
  const splits = [];
  let nSets = 0;
  MICROS.forEach((micro, m) => {
    const monday = d(-21 + 7 * m);
    const workoutIds = [];
    SESSIONS.forEach((ses, s) => {
      const date = addDaysToIsoDate(monday, ses.dow);
      const done = date < TODAY || (date === TODAY && false);
      const exercises = [];
      ses.ex.forEach(([name, series, reps, base, rest], e) => {
        const nSeries = Math.max(2, Math.round(series * micro.sets));
        const sets = [];
        for (let k = 0; k < nSeries; k++) {
          const doc = { _id: oid(`set:${m}:${s}:${e}:${k}`), order: k, expectedReps: reps, expectedRir: [2, 1], restSeconds: rest };
          if (done) {
            doc.reps = reps[0] + ((k + e) % 3);
            doc.weight = Math.round(base * micro.factor * (1 + k * 0.01) * 2) / 2;
            doc.rir = [2];
            doc.doned = true;
            doc.donedAt = at(date, "19:" + (10 + k * 3));
          }
          sets.push(doc);
          nSets++;
        }
        const cex = { _id: oid(`cex:${m}:${s}:${e}`), order: e, exercise: exerciseIds[name], sets };
        if (m === 3 && name === "Sentadilla barra alta") cex.notes = "Semana de descarga: RIR 3, sin buscar el fallo.";
        if (name === "Press banca") cex.notes = "Escápulas retraídas y codos a 45°.";
        if (done && name === "Sentadilla barra alta" && m === 1) cex.clientNotes = "La rodilla derecha molestó un poco en la última serie.";
        exercises.push(cex);
      });
      const w = { kind: "session", name: ses.name, exercises, order: s };
      if (done) {
        w.date = at(date, "19:00");
        w.readinessPre = 3 + (rnd(`wr:${m}:${s}`) < 0.6 ? 1 : 0);
        w.perceivedEffortPost = micro.purpose === "deload" ? 2 : 3 + (rnd(`we:${m}:${s}`) < 0.5 ? 1 : 0);
        w.sorenessPre = ses.name.startsWith("Torso") ? [{ muscle: "Pectoral", level: 2 }] : [{ muscle: "Cuádriceps", level: 3 }, { muscle: "Glúteo", level: 2 }];
      }
      add("Workout", oid(`w:${m}:${s}`), w);
      workoutIds.push(oid(`w:${m}:${s}`));
    });
    splits.push({ _id: oid("split:" + m), name: micro.name, objective: micro.objective, purpose: micro.purpose, workouts: workoutIds });
  });

  const tableId = oid("table");
  add("Table", tableId, { name: "Hipertrofia torso-pierna", userId: CLIENT_ID, assignedByTrainerId: TRAINER_ID, splits });
  add("RoutineAssignment", oid("routine"), { tableId, clientId: CLIENT_ID, trainerId: TRAINER_ID, startDate: d(-21), createdAt: at(d(-21)) });

  for (const ses of SESSIONS) {
    for (const [name, , , , , muscles, joints] of ses.ex) {
      add("ExerciseScore", oid("score:" + name), {
        trainerId: TRAINER_ID,
        exerciseId: exerciseIds[name],
        muscleScores: muscles.map(([n, score]) => ({ name: n, score })),
        jointScores: joints.map(([n, score]) => ({ name: n, score })),
        secondsPerSet: 45,
      });
    }
  }
  return { tableId, sets: nSets };
}

// ---------------------------------------------------------------------------
// SEGUIMIENTO: hábitos, dolor, suplementos, notas, cobros, historial, pendientes
// ---------------------------------------------------------------------------
function buildTracking(kcalP2) {
  // Hábitos (el de pasos ya lo tienen; no se toca)
  const HABITS = [
    { key: "water", type: "water", label: null, target: 2.5, unit: "l", rate: 0.85 },
    { key: "sleep", type: "sleep", label: null, target: 7.5, unit: "h", rate: 0.7 },
    { key: "stretch", type: "custom", label: "Estiramientos de cadera", target: 10, unit: "min", rate: 0.6 },
  ];
  let marks = 0;
  for (const h of HABITS) {
    const taskId = oid("task:" + h.key);
    add("TrainerTask", taskId, { trainerId: TRAINER_ID, clientId: CLIENT_ID, type: h.type, label: h.label, target: h.target, targetMax: null, unit: h.unit, active: true, createdAt: at(d(-40)) });
    for (let k = 0; k < 28; k++) {
      if (rnd(`hab:${h.key}:${k}`) >= h.rate) continue;
      add("TaskCompletion", oid(`taskc:${h.key}:${k}`), { taskId, date: addDaysToIsoDate(TODAY, -k), completed: true, completedAt: at(addDaysToIsoDate(TODAY, -k), "21:30") });
      marks++;
    }
  }

  // Dolor: rodilla derecha que mejora + hombro izquierdo ya resuelto
  const knee = [3, 4, 5, 6, 6, 5, 4, 4, 3, 2];
  knee.forEach((level, i) =>
    add("PainEntry", oid("pain:knee:" + i), { userId: CLIENT_ID, date: addDaysToIsoDate(TODAY, -(knee.length - 1 - i) * 2), zone: "Rodilla der.", level, note: i < 5 ? "Al bajar en sentadilla" : "Casi no lo noto" })
  );
  [2, 1, 1, 0].forEach((level, i) =>
    add("PainEntry", oid("pain:shoulder:" + i), { userId: CLIENT_ID, date: addDaysToIsoDate(TODAY, -(3 - i) * 5 - 1), zone: "Hombro izq.", level, note: "" })
  );
  // El umbral vive en el par entrenador-cliente: se escribe aparte (ver main).
  PAIN_THRESHOLDS.push({ zone: "Rodilla der.", workLevel: 3, painLevel: 5, note: "Hasta 3 entrena normal. Desde 5, fuera sentadilla profunda y prensa." });

  // Suplementos (nombres distintos a los que ya tienen)
  const SUPPS = [
    { name: "Vitamina D3", dose: "2000 UI", timing: "breakfast", reason: "Analítica por debajo de rango. Revisar en la próxima.", weekdays: [] },
    { name: "Magnesio bisglicinato", dose: "300 mg", timing: "before_bed", reason: "Mejorar la calidad del sueño durante la definición.", weekdays: [] },
    { name: "Proteína de suero", dose: "1 cazo (30 g)", timing: "custom", customTiming: "Cuando no llegues a la proteína del día", reason: "Red de seguridad, no es obligatoria.", weekdays: [1, 2, 4, 5] },
  ];
  SUPPS.forEach((s, i) =>
    add("Supplement", oid("supp:" + i), { trainerId: TRAINER_ID, clientId: CLIENT_ID, active: true, customTiming: "", purchaseUrl: "", startDate: d(-30 + i * 3), endDate: null, ...s })
  );

  // Notas privadas del entrenador
  const NOTES = [
    { text: "Viaja por trabajo la primera semana de cada mes. Ajustar volumen esas semanas.", pinned: true, days: 40 },
    { text: "Rodilla derecha: condromalacia antigua. Nada de sentadilla profunda con carga alta.", pinned: true, days: 33 },
    { text: "Le cuesta la cena. Probar cenas con más volumen y menos grasa.", pinned: false, days: 12 },
    { text: "Ha bajado 2 kg en 4 semanas. Ritmo correcto, no tocar nada.", pinned: false, days: 3 },
  ];
  NOTES.forEach((n, i) => add("TrainerNote", oid("note:" + i), { trainerId: TRAINER_ID, clientId: CLIENT_ID, text: n.text, pinned: n.pinned, createdAt: at(addDaysToIsoDate(TODAY, -n.days), "18:00") }));

  // Cobros: uno pagado, uno pendiente próximo y uno vencido
  [[-55, true, "Mensualidad agosto"], [-25, true, "Mensualidad septiembre"], [-3, false, "Ajuste de plan (vencido)"], [6, false, "Mensualidad octubre"]].forEach(([off, paid, note], i) =>
    add("TrainerPayment", oid("pay:" + i), { trainerId: TRAINER_ID, clientId: CLIENT_ID, amount: 60, currency: "EUR", dueDate: at(addDaysToIsoDate(TODAY, off)), paidAt: paid ? at(addDaysToIsoDate(TODAY, off)) : null, note })
  );

  // Historial de cambios con motivo
  const CHANGES = [
    { days: 70, entity: "diet_plan", action: "assigned", name: "Adaptación", reason: "Alta. Empezamos en mantenimiento para medir adherencia real.", changes: [{ field: "kcalTotal", label: "Calorías", previousValue: null, newValue: null }] },
    { days: 42, entity: "routine", action: "assigned", name: "Hipertrofia torso-pierna", reason: "Cierra el bloque de adaptación. Entra torso-pierna de 3 días.", changes: [{ field: "name", label: "Rutina", previousValue: null, newValue: "Hipertrofia torso-pierna" }] },
    { days: 28, entity: "diet_plan", action: "replaced", name: "Definición", reason: "Pasa a definición: -300 kcal sobre el gasto calculado.", changes: [{ field: "name", label: "Fase", previousValue: "Adaptación", newValue: "Definición" }] },
    { days: 14, entity: "diet_plan", action: "updated", name: "Definición vegetariana", reason: "Perdía menos de lo previsto: bajo un 4 % las cantidades esta semana.", changes: [{ field: "kcalTotal", label: "Calorías", previousValue: kcalP2, newValue: Math.round(kcalP2 * 0.96) }] },
    { days: 10, entity: "checkin_config", action: "updated", name: "Check-in semanal", reason: "Añado la pregunta de comidas fuera de casa: es donde se le escapa el plan.", changes: [{ field: "customQuestions", label: "Preguntas propias", previousValue: 5, newValue: 6 }] },
  ];
  CHANGES.forEach((c, i) =>
    add("PlanChange", oid("pchg:" + i), { trainerId: TRAINER_ID, clientId: CLIENT_ID, entity: c.entity, entityId: null, entityName: c.name, action: c.action, changes: c.changes, reason: c.reason, createdAt: at(addDaysToIsoDate(TODAY, -c.days), "11:00") })
  );

  // Pendientes del entrenador
  const TASKS = [
    { title: "Preparar la semana 6 de Test User", client: true, due: 3, done: false },
    { title: "Revisar el check-in sin ver de la semana 4", client: true, due: 0, done: false },
    { title: "Grabar vídeo de técnica de peso muerto rumano", client: false, due: 5, done: false },
    { title: "Pedir analítica de vitamina D a Test User", client: true, due: -4, done: true },
  ];
  TASKS.forEach((t, i) =>
    add("CoachTask", oid("ctask:" + i), { trainerId: TRAINER_ID, clientId: t.client ? CLIENT_ID : null, title: t.title, notes: "", dueDate: addDaysToIsoDate(TODAY, t.due), status: t.done ? "done" : "pending", completedAt: t.done ? at(addDaysToIsoDate(TODAY, t.due + 1)) : null, createdAt: at(addDaysToIsoDate(TODAY, -6)) })
  );
  return { habits: HABITS.length, marks };
}

// ---------------------------------------------------------------------------
// APLICAR / VALIDAR / BORRAR
// ---------------------------------------------------------------------------
const MODEL_FILES = {
  Product: "products/product-schema",
  DietTemplate: "dietTemplates/diet-template-schema",
  DietPhase: "dietPhases/diet-phase-schema",
  DietDay: "dietDays/diet-days-schema",
  CheckinTemplateDefinition: "trainerCheckins/checkin-template-definition-schema",
  CheckinSchedule: "trainerCheckins/checkin-schedule-schema",
  CheckinResponse: "trainerCheckins/checkin-response-schema",
  Table: "tables/table-schema",
  Workout: "workouts/workout-schema",
  RoutineAssignment: "routineAssignments/routine-assignment-schema",
  ExerciseScore: "exerciseScores/exercise-score-schema",
  TrainerTask: "trainerTasks/trainer-task-schema",
  TaskCompletion: "trainerTasks/task-completion-schema",
  Supplement: "supplements/supplement-schema",
  TrainerNote: "trainerNotes/trainer-note-schema",
  TrainerPayment: "trainerPayments/trainer-payment-schema",
  PlanChange: "planChanges/plan-change-schema",
  CoachTask: "coachTasks/coach-task-schema",
};
function modelOf(name) {
  if (name === "Anthropometry") return require("../components/anthropometry/anthropometry-schema");
  if (name === "PainEntry") return require("../components/painLog/pain-schema").PainEntry;
  if (name === "Supplement") return require("../components/supplements/supplement-schema").Supplement;
  const mod = require("../components/" + MODEL_FILES[name]);
  return mod;
}

function validateAll() {
  const errors = [];
  const unknown = new Set();
  for (const op of ops) {
    const Model = modelOf(op.model);
    const doc = new Model({ _id: op._id, ...op.doc });
    const err = doc.validateSync();
    if (err) errors.push(`${op.model} ${op._id}: ${err.message}`);
    for (const key of Object.keys(op.doc)) {
      if (Model.schema.pathType(key) === "adhocOrUndefined") unknown.add(`${op.model}.${key}`);
    }
  }
  return { errors, unknown: [...unknown] };
}

async function bulk(Model, batch) {
  const writes = batch.map((op) => ({ updateOne: { filter: { _id: op._id }, update: { $set: op.doc }, upsert: true } }));
  for (let attempt = 1; ; attempt++) {
    try {
      return await Model.bulkWrite(writes, { ordered: false });
    } catch (e) {
      if (attempt >= 3) throw e;
      console.warn(`  reintento ${attempt} (${e.message})`);
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const DELETE_ORDER = ["DietDay", "DietPhase", "DietTemplate", "Table", "Workout"];
// Umbrales de dolor: van dentro del par (TrainerClient.painThresholds).
const PAIN_THRESHOLDS = [];

async function main() {
  const uri = buildMongoUri();
  console.log(`[seed-full] ${CLEAN ? "CLEAN" : DRY ? "DRY-RUN" : "SEED"} ${redactMongoUri(uri)}`);
  console.log(`[seed-full] hoy=${TODAY} lunes=${MON0} fase1=${P1_START}..${P1_END} fase2=${P2_START}..`);
  await mongoose.connect(uri);

  const User = require("../components/users/user-schema");
  const trainer = await User.findOne({ email: TRAINER_EMAIL }).select("_id roles").lean();
  const client = await User.findOne({ email: CLIENT_EMAIL }).select("_id sex height birth steps activity training objetive").lean();
  if (!trainer || !client) throw new Error(`Faltan cuentas: ${!trainer ? TRAINER_EMAIL : ""} ${!client ? CLIENT_EMAIL : ""}. Este script no las crea.`);
  // `training` guarda el factor COMBINADO de la tabla pasos × días de
  // entrenamiento (training-factor.js): uno que no casa con ninguna columna
  // del rango de pasos del perfil inflaría la necesidad (p. ej. steps 1 con
  // training 1.5 daba ~3.400 kcal) y todo lo sembrado saldría desmedido.
  const profileTraining = trainingDaysFromFactors(client.steps, client.training);
  if (!CLEAN && !(profileTraining && profileTraining.exact)) {
    throw new Error(`El perfil de ${CLIENT_EMAIL} tiene steps=${client.steps} y training=${client.training}, que no es un factor válido: corrígelo antes de sembrar.`);
  }
  TRAINER_ID = trainer._id;
  CLIENT_ID = client._id;
  console.log(`[seed-full] trainer=${TRAINER_ID} cliente=${CLIENT_ID}`);

  // Antropometría existente (no se pisa) y ejercicios del catálogo
  require("../components/anthropometry/anthropometry-dao");
  // Fechas ocupadas por filas que NO son de este seed (las suyas se reescriben).
  const existing = await require("../components/anthropometry/anthropometry-schema").find({ userId: CLIENT_ID }).select("date").lean();
  const ownIds = new Set(Array.from({ length: 200 }, (_, i) => String(oid("anth:" + (i - 100)))));
  const existingDates = new Set(existing.filter((a) => !ownIds.has(String(a._id))).map((a) => a.date));

  const Exercise = require("../components/exercises/exercise-schema");
  const exerciseIds = {};
  const missing = [];
  for (const ses of SESSIONS) {
    for (const [name] of ses.ex) {
      if (CLEAN) { exerciseIds[name] = oid("x:" + name); continue; }
      const rx = new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
      const found = await Exercise.findOne({ name: rx, userId: { $in: [null, undefined] } }).select("_id").lean()
        || await Exercise.findOne({ name: rx }).select("_id").lean();
      if (found) exerciseIds[name] = found._id; else missing.push(name);
    }
  }
  if (missing.length) throw new Error("Ejercicios no encontrados en el catálogo: " + missing.join(", "));

  buildFoods();
  const nut = buildNutrition(client);
  const dd = buildDietDays(nut.contents);
  const ci = buildCheckins(nut.phases, existingDates);
  const tr = buildTraining(exerciseIds);
  const tk = buildTracking(nut.needP2.target.kcal);

  const byModel = {};
  for (const op of ops) (byModel[op.model] ||= []).push(op);

  if (CLEAN) {
    for (const name of [...DELETE_ORDER, ...Object.keys(byModel).filter((n) => !DELETE_ORDER.includes(n))]) {
      if (!byModel[name]) continue;
      const res = await modelOf(name).deleteMany({ _id: { $in: byModel[name].map((o) => o._id) } });
      console.log(`  - ${name.padEnd(26)} ${res.deletedCount}`);
    }
    await User.updateOne({ _id: CLIENT_ID, tableInUse: tr.tableId }, { $unset: { tableInUse: 1, tableInUseAt: 1 } });
    const trainerClientDao = require("../components/trainerClients/trainer-client-dao");
    for (const threshold of PAIN_THRESHOLDS) await trainerClientDao.removePainThreshold(TRAINER_ID, CLIENT_ID, threshold.zone);
    await mongoose.disconnect();
    console.log("[seed-full] limpio");
    return;
  }

  const { errors, unknown } = validateAll();
  console.log("\n[seed-full] documentos por colección:");
  for (const [name, list] of Object.entries(byModel)) console.log(`  ${name.padEnd(26)} ${list.length}`);
  console.log(`\n  Necesidad fase 2: ${JSON.stringify(nut.needP2.target)}  (fase 1: ${nut.needP1.target.kcal} kcal)`);
  console.log("  Biblioteca:");
  for (const s of nut.libStats) console.log(`    ${s.name.padEnd(42)} ${s.kcal} kcal P${s.protein} C${s.carbs} G${s.fat}  [${s.suitableFor.join(",")}]`);
  console.log(`  Días de dieta: ${dd.days}, ítems pautados ${dd.planned}, consumidos ${dd.consumed} (${Math.round((100 * dd.consumed) / dd.planned)} %)`);
  console.log(`  Check-ins: ${ci.responses} respuestas, antropometría +${ci.anthroRows} (omitidas por existir: ${ci.anthroSkipped})`);
  console.log(`  Entreno: ${tr.sets} series. Hábitos: ${tk.habits} (+${tk.marks} marcas)`);
  if (unknown.length) console.log("\n  ATENCIÓN campos que el esquema descartaría:", unknown.join(", "));
  if (errors.length) {
    console.error(`\n[seed-full] ${errors.length} documentos NO validan:`);
    errors.slice(0, 15).forEach((e) => console.error("  " + e));
    throw new Error("Validación fallida; no se escribe nada.");
  }
  console.log("\n[seed-full] validación OK (todos los documentos casan con su esquema)");
  if (DRY) {
    await mongoose.disconnect();
    console.log("[seed-full] dry-run: no se ha escrito nada");
    return;
  }

  // Orden: primero lo que otros referencian
  const order = ["Product", "DietTemplate", "DietPhase", "DietDay", "Anthropometry", "CheckinTemplateDefinition", "CheckinSchedule", "CheckinResponse",
    "Workout", "Table", "RoutineAssignment", "ExerciseScore", "TrainerTask", "TaskCompletion", "PainEntry",
    "Supplement", "TrainerNote", "TrainerPayment", "PlanChange", "CoachTask"];
  for (const name of order) {
    const list = byModel[name] || [];
    for (let i = 0; i < list.length; i += 250) await bulk(modelOf(name), list.slice(i, i + 250));
    if (list.length) console.log(`  + ${name.padEnd(26)} ${list.length}`);
  }
  const trainerClientDao = require("../components/trainerClients/trainer-client-dao");
  for (const threshold of PAIN_THRESHOLDS) {
    if (!(await trainerClientDao.setPainThreshold(TRAINER_ID, CLIENT_ID, threshold))) {
      console.log("  ! sin relación entre las dos cuentas: umbrales de dolor no sembrados");
      break;
    }
  }
  if (PAIN_THRESHOLDS.length) console.log(`  + TrainerClient.painThresholds  ${PAIN_THRESHOLDS.length}`);
  // La rutina sembrada queda en uso por su fase (routineAssignments/routine-in-use.js).
  await mongoose.disconnect();
  console.log("[seed-full] hecho");
}

main().catch(async (e) => {
  console.error(e);
  try { await mongoose.disconnect(); } catch { /* noop */ }
  process.exit(1);
});
