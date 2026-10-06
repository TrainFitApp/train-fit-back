const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const crypto = require("crypto");
const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
const { buildSearchFields } = require("../components/util/search-index");

/**
 * Cuenta de prueba mínima: un entrenador (t@t.t) con un cliente (u@u.u) ya
 * vinculado (relación activa en entrenamiento Y nutrición, sin pasar por el
 * flujo de invitación/cuestionario). Misma contraseña para los dos.
 *
 * Además siembra los datos de nutrición de u@u.u necesarios para probar el
 * cajón de "sugerencias de dieta" (docs/feature-sugerencias-dietas.md) con
 * login de entrenador: check-in de antropometría, preferencias dietéticas
 * (`dietaryFlags` para el filtro duro), objetivo nutricional vigente
 * (`goalInUse`) y una mini biblioteca de plantillas de t@t.t (omnívora /
 * alta en proteína / vegetariana / vegana) para que el ranking devuelva algo.
 *
 * Criterio paranoico (corre contra `pre`,
 * Atlas compartido):
 *   - _id DETERMINISTA a partir de una semilla -> volver a correrlo no
 *     duplica nada, reescribe los mismos documentos.
 *   - create() (no updateOne/insertMany) para que el pre('save') del
 *     esquema cifre la contraseña.
 *   - Las plantillas de dieta llevan el sufijo " [seed-test-account]" en el
 *     nombre (mismo patrón que seed-diet-suggestions-demo.js) -> se borran
 *     por nombre, no hace falta manifiesto.
 *   - `--clean` borra EXACTAMENTE estos 2 usuarios + su relación (TrainerClient) +
 *     los datos de nutrición de u@u.u sembrados aquí.
 *
 * USO
 *   node scripts/seed-test-trainer-client.js          -> siembra
 *   node scripts/seed-test-trainer-client.js --clean   -> borra
 */

const PASSWORD = "Abcd123$";
const TRAINER_EMAIL = "t@t.t";
const CLIENT_EMAIL = "u@u.u";
const TEMPLATE_MARK = " [seed-test-account]";
const TEMPLATE_NAME_RX = "\\[seed-test-account\\]$";

function oid(semilla) {
  const hex = crypto.createHash("md5").update("tf-test-account:" + semilla).digest("hex").slice(0, 24);
  return new mongoose.Types.ObjectId(hex);
}

const TRAINER_ID = oid("trainer:t@t.t");
const CLIENT_ID = oid("client:u@u.u");
const PAIR_ID = oid("rel:pair");
const GOAL_ID = oid("goal:u@u.u");

// Los alimentos son Product REALES, no macros sueltas: una plantilla de
// biblioteca guarda {product, quantity} y todo lo que la lee (constructor
// del entrenador, perfil de macros, aptitud vegana/sin gluten) saca los
// datos del Product poblado. Sembrar CustomProducts sin `product` colaba en
// base de datos pero el constructor no podía pintarlos: la dieta se abría
// vacía y al guardarla esos alimentos se perdían.
//
// quantity:100 => el aporte del producto == sus *_100g (mismo helper que
// seed-diet-suggestions-demo.js).
const FOODS = new Map();
const P = (name, kcal, protein, carbs, fat, flags) => {
  const _id = oid("product:" + name);
  if (!FOODS.has(name)) {
    const fullName = name + TEMPLATE_MARK;
    FOODS.set(name, {
      _id,
      name: fullName,
      userId: TRAINER_ID,
      energyKcal100g: kcal,
      protein100g: protein,
      carbohydrates100g: carbs,
      fat100g: fat,
      vegan: !!flags.vegan,
      vegetarian: !!flags.vegetarian,
      lactoseFree: !!flags.lactoseFree,
      glutenFree: !!flags.glutenFree,
      ...buildSearchFields({ name: fullName }),
    });
  }
  return { quantity: 100, product: _id };
};
const menu = (products) => [
  { name: "Menú 1", meals: [{ slot: "Comida", alternatives: [{ label: "", customProducts: products, customRecipes: [] }] }] },
];
const OMNI = { lactoseFree: true, glutenFree: true };
const VEGAN = { vegan: true, vegetarian: true, lactoseFree: true, glutenFree: true };
const VEG = { vegetarian: true, glutenFree: true };

// Alrededor del objetivo real de u@u.u (~3384 kcal / P120 / C599 / G56 —
// ver computeNutritionTarget más abajo) para que el ranking tenga sentido:
// la vegetariana cae prácticamente encima, la omnívora balanceada también,
// la alta en proteína y la vegana quedan más lejos pero dentro de rango.
const O = () => P("Base omnívora", 1700, 60, 300, 28, OMNI);
const PRO = () => P("Base alta en proteína", 1700, 90, 255, 28, OMNI);
const V = () => P("Base vegetariana", 1700, 60, 300, 28, VEG);
const VG1 = () => P("Base vegana comida", 1400, 55, 220, 30, VEGAN);
const VG2 = () => P("Base vegana cena", 1300, 50, 200, 28, VEGAN);

const TEMPLATES = [
  ["Definición omnívora" + TEMPLATE_MARK, menu([O(), O()])],
  ["Alta en proteína" + TEMPLATE_MARK, menu([PRO(), PRO()])],
  ["Vegetariana equilibrada" + TEMPLATE_MARK, menu([V(), V()])],
  ["Vegana ligera" + TEMPLATE_MARK, menu([VG1(), VG2()])],
];

function ageFromBirth(birth) {
  const ms = Date.now() - new Date(birth).getTime();
  return Math.floor(ms / (1000 * 3600 * 24) / 365.25);
}

const clean = process.argv.includes("--clean");

async function main() {
  const uri = buildMongoUri();
  console.log("[test-account]", clean ? "CLEAN" : "SEED", redactMongoUri(uri));
  await mongoose.connect(uri);

  const User = require("../components/users/user-schema");
  const TrainerClient = require("../components/trainerClients/trainer-client-schema");
  require("../components/anthropometry/anthropometry-dao"); // registra el modelo "Anthropometry"
  const dietTemplateDao = require("../components/dietTemplates/diet-template-dao");
  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const { computeNutritionTarget } = require("../components/nutritionalGoals/nutrition-target");
  const Product = require("../components/products/product-schema");
  require("../components/recipes/recipe-schema");

  if (clean) {
    await TrainerClient.deleteMany({ _id: PAIR_ID });
    const tpls = await DietTemplate.deleteMany({ trainerId: TRAINER_ID, name: { $regex: TEMPLATE_NAME_RX } });
    // Después de las plantillas (su contenido va dentro y se borra con ellas).
    await Product.deleteMany({ _id: { $in: [...FOODS.values()].map((f) => f._id) } });
    await require("../components/anthropometry/anthropometry-schema").deleteMany({ userId: CLIENT_ID });
    await User.updateOne({ _id: CLIENT_ID }, { $unset: { nutritionPreferences: 1 } });
    await User.deleteMany({ _id: { $in: [TRAINER_ID, CLIENT_ID] } });
    console.log(
      "[test-account] borrados t@t.t, u@u.u, su relación, antropometría, preferencias, objetivo y",
      tpls.deletedCount,
      "plantillas"
    );
    await mongoose.disconnect();
    return;
  }

  await User.deleteOne({ _id: TRAINER_ID });
  const trainer = await User.create({
    _id: TRAINER_ID,
    name: "Test",
    lastname: "Trainer",
    email: TRAINER_EMAIL,
    password: PASSWORD, // hook pre('save') lo cifra
    status: "active",
    roles: ["trainer"],
    theme: "dark",
    lang: "es",
  });
  console.log("[test-account] trainer", TRAINER_EMAIL, "->", trainer._id.toString());

  await User.deleteOne({ _id: CLIENT_ID });
  const client = await User.create({
    _id: CLIENT_ID,
    name: "Test",
    lastname: "User",
    email: CLIENT_EMAIL,
    password: PASSWORD,
    status: "active",
    roles: ["user"],
    sex: 1,
    height: 175,
    birth: new Date("1995-01-01"),
    activity: 1.45,
    steps: 1, // STEPS_NOT_COUNTED -> usa el factor de actividad
    training: 1.5,
    objetive: -300,
    theme: "dark",
    lang: "es",
  });
  console.log("[test-account] cliente", CLIENT_EMAIL, "->", client._id.toString());

  const now = new Date();
  await TrainerClient.updateOne(
    { _id: PAIR_ID },
    {
      $set: {
        trainerId: TRAINER_ID,
        clientId: CLIENT_ID,
        clientEmail: CLIENT_EMAIL,
        scopes: ["training", "nutrition"].map((scope) => ({ scope, status: "active", invitedAt: now, respondedAt: now })),
      },
    },
    { upsert: true }
  );
  console.log("[test-account] vinculados (training + nutrition, status active)");

  // Medida con peso: el peso vive en Anthropometry (el cajón de sugerencias
  // y el objetivo lo leen de ahí).
  const ANTHRO_DATE = "2026-09-08";
  await require("../components/anthropometry/anthropometry-schema").updateOne(
    { userId: CLIENT_ID, date: ANTHRO_DATE },
    { $set: { userId: CLIENT_ID, date: ANTHRO_DATE, weight: 76.4, waist: 84, neck: 38 } },
    { upsert: true }
  );
  console.log("[test-account] antropometría", ANTHRO_DATE, "-> 76.4 kg");

  // Preferencias dietéticas — dietaryFlags alimenta el filtro duro del cajón
  // de sugerencias; allergies/favoriteFoods/dislikedFoods son el texto libre
  // que ya lee la ficha del cliente.
  await User.updateOne(
    { _id: CLIENT_ID },
    {
      $set: {
        nutritionPreferences: {
          allergies: "Frutos secos",
          dietaryFlags: ["vegetarian"],
          favoriteFoods: "Pollo, arroz, batata, huevos",
          dislikedFoods: "Brócoli, pescado azul",
          cooksAtHome: "yes",
          requestedBy: TRAINER_ID,
          requestedAt: new Date(),
          respondedAt: new Date(),
        },
      },
    }
  );
  console.log("[test-account] preferencias nutricionales -> dietaryFlags ['vegetarian']");

  // Objetivo nutricional vigente — mismo cálculo que hace el cajón
  // (computeNutritionTarget) para que el `goalInUse` que ve el entrenador ya
  // coincida con lo que la sugerencia va a proponer.
  const target = computeNutritionTarget({
    weightKg: 76.4,
    heightCm: client.height,
    age: ageFromBirth(client.birth),
    sex: client.sex,
    activity: client.activity,
    steps: client.steps,
    training: client.training,
    objetiveKcalDelta: client.objetive,
  });
  await User.updateOne(
    { _id: CLIENT_ID },
    {
      $set: {
        nutritionalGoals: [
          {
            _id: GOAL_ID,
            name: "Objetivo (seed test)",
            kcalTotal: target.kcal,
            proteinsGTotal: target.protein,
            carbohydratesGTotal: target.carbs,
            fatGTotal: target.fat,
          },
        ],
        goalInUse: GOAL_ID,
      },
    },
  );
  console.log(
    "[test-account] objetivo nutricional ->",
    target.kcal, "kcal  P" + target.protein, "C" + target.carbs, "G" + target.fat
  );

  // Mini biblioteca de plantillas de t@t.t alrededor de ese objetivo, para
  // que el ranking del cajón de sugerencias devuelva algo real (omnívora +
  // alta en proteína salen SIEMPRE; vegetariana/vegana pasan también el
  // filtro duro con dietaryFlags=['vegetarian']).
  await DietTemplate.deleteMany({ trainerId: TRAINER_ID, name: { $regex: TEMPLATE_NAME_RX } });
  for (const food of FOODS.values()) {
    await Product.updateOne({ _id: food._id }, { $set: food }, { upsert: true });
  }
  console.log("[test-account] alimentos ->", FOODS.size, "productos del catálogo de t@t.t");
  for (const [name, menus] of TEMPLATES) {
    const created = await dietTemplateDao.create(TRAINER_ID, { name, menus });
    console.log("  +", name, "-> suitableFor", JSON.stringify(created.suitableFor));
  }

  await mongoose.disconnect();
  console.log(`\n[test-account] listo:\n  entrenador  ${TRAINER_EMAIL} / ${PASSWORD}\n  cliente     ${CLIENT_EMAIL} / ${PASSWORD}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
