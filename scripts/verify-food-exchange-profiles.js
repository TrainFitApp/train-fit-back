const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
// `populate` de items.productId resuelve el modelo por su nombre, y en un
// script no hay arranque de app que lo haya registrado antes.
require("../components/products/product-schema");
const {
  MACROS,
  itemMacros,
  itemDeviation,
  isCompleteServing,
  sumReparto,
} = require("../components/foodExchanges/exchange-profile");

// Comprobación de scripts/migrate-food-exchange-profiles.js, y de paso el
// primer informe que contesta la pregunta por la que existe todo esto:
// ¿cuadra lo que este entrenador tiene pautado?
//
// Dos partes:
//   1. Por grupo — qué alimentos se salen del criterio que él mismo declaró.
//      Hasta ahora nadie lo comprobaba: un intercambio mal calculado se
//      propagaba a todos sus clientes en silencio.
//   2. Por objetivo — qué suma el reparto en intercambios contra los gramos
//      del mismo objetivo. Son dos formas de pautar el mismo día y nada
//      verificaba que dijeran lo mismo.
//
// No escribe nada.
//
// Uso:
//   node scripts/verify-food-exchange-profiles.js
//   node scripts/verify-food-exchange-profiles.js --trainer <id>

const LOG_PREFIX = "[verify-food-exchange-profiles]";
const log = (...args) => console.log(LOG_PREFIX, ...args);

const trainerArg = process.argv[process.argv.indexOf("--trainer") + 1];
const TRAINER_ID =
  process.argv.includes("--trainer") && mongoose.isValidObjectId(trainerArg) ? trainerArg : null;

const PRODUCT_MACROS = "energyKcal100g protein100g carbohydrates100g fat100g";

function fmtServing(serving) {
  return MACROS.map((macro) => {
    const value = serving?.[macro];
    return `${macro}:${value === null || value === undefined ? "—" : value}`;
  }).join(" ");
}

async function checkGroups() {
  const FoodExchangeGroup = require("../components/foodExchanges/food-exchange-schema");

  const groups = await FoodExchangeGroup.find(TRAINER_ID ? { trainerId: TRAINER_ID } : {})
    .populate({ path: "items.productId", select: PRODUCT_MACROS })
    .sort({ trainerId: 1, category: 1, name: 1 })
    .lean();

  log(`=== GRUPOS (${groups.length}) ===`);
  const totals = { sinPerfil: 0, incompletos: 0, libres: 0, fueraDeTolerancia: 0, sinVincular: 0 };

  for (const group of groups) {
    const serving = group.serving || {};
    const tolerance = Number.isFinite(group.tolerancePct) ? group.tolerancePct : 10;

    let estado;
    if (group.freeQuantity) {
      estado = "LIBRE (no entra en el cuadre)";
      totals.libres += 1;
    } else if (!isCompleteServing(serving)) {
      estado = "INCOMPLETO (no cuadra el día)";
      totals.incompletos += 1;
    } else {
      estado = "completo";
    }
    if (!group.anchor && !group.freeQuantity) estado += " · sin criterio declarado";

    log(`\n${group.name}${group.category ? ` [${group.category}]` : ""} — ${estado}`);
    log(`  1 ración = ${fmtServing(serving)}  (${group.servingSource || "?"}, ±${tolerance}%)`);

    // El rango de kcal entre alimentos es la calidad real del grupo: si va de
    // 83 a 206, esos alimentos no son intercambiables en calorías por mucho
    // que igualen la proteína, y el cliente merece saberlo.
    const kcals = (group.items || [])
      .map((item) => itemMacros(item)?.kcal)
      .filter((value) => value !== null && value !== undefined);
    if (kcals.length > 1) {
      const min = Math.min(...kcals);
      const max = Math.max(...kcals);
      const spread = min > 0 ? Math.round(((max - min) / min) * 100) : 0;
      log(`  rango real entre alimentos: ${min}–${max} kcal (${spread}% de dispersión)`);
    }

    for (const item of group.items || []) {
      const label = `    ${item.quantity} ${item.unit} ${item.name} —`;
      const macros = itemMacros(item);

      // El motivo tiene que ser el de verdad. Decir "sin vincular" de un
      // alimento que sí lo está, porque lo que falta es el anchor del grupo,
      // manda a arreglar donde no hay nada roto.
      if (!macros) {
        let why;
        if (!item.productId) {
          why = "sin vincular";
          totals.sinVincular += 1;
        } else if (!item.productId?.energyKcal100g && typeof item.productId !== "object") {
          why = "producto borrado del catálogo";
        } else if (!["g", "ml"].includes(String(item.unit || "g"))) {
          why = `pautado en ${item.unit}, que no escala por 100 g`;
        } else {
          why = "producto borrado o sin macros en el catálogo";
        }
        log(`${label} no comprobable (${why})`);
        continue;
      }

      if (!group.anchor) {
        // Vinculado y calculable, pero el grupo no dice qué iguala. No hay
        // nada que exigirle: se enseña lo que aporta y ya.
        log(`${label} ${fmtServing(macros)}  (el grupo no declara qué iguala)`);
        continue;
      }

      const deviation = itemDeviation(item, serving, group.anchor);
      if (!deviation) {
        log(`${label} ${fmtServing(macros)}  (el grupo no tiene perfil en ${group.anchor})`);
        continue;
      }
      const out = Math.abs(deviation.pct) > tolerance;
      if (out) totals.fueraDeTolerancia += 1;
      log(
        `${label} ${deviation.actual} vs ${deviation.expected} ${deviation.macro} ` +
          `(${deviation.pct > 0 ? "+" : ""}${deviation.pct}%)${out ? "   << FUERA" : ""}`
      );
    }
  }

  log(
    `\nRESUMEN GRUPOS: libres=${totals.libres} incompletos=${totals.incompletos} ` +
      `alimentos fuera de tolerancia=${totals.fueraDeTolerancia} sin vincular=${totals.sinVincular}`
  );
}

async function checkGoals() {
  const NutritionalGoal = require("../components/nutritionalGoals/nutritional-goal-schema");

  const goals = await NutritionalGoal.find({ "mealExchanges.0": { $exists: true } })
    .select("name userId kcalTotal proteinsGTotal carbohydratesGTotal fatGTotal mealExchanges")
    .lean();

  log(`\n=== CUADRE DE OBJETIVOS CON REPARTO (${goals.length}) ===`);
  if (!goals.length) {
    log("Ninguno. Todos los objetivos se pautan solo en gramos.");
    return;
  }

  const target = {
    kcal: "kcalTotal",
    protein: "proteinsGTotal",
    carbs: "carbohydratesGTotal",
    fat: "fatGTotal",
  };

  for (const goal of goals) {
    const { totals, counted, free, incomplete } = sumReparto(goal.mealExchanges);
    log(`\n${goal.name} (cliente ${goal.userId})  —  ${counted} raciones con perfil`);

    for (const macro of MACROS) {
      const objetivo = Number(goal[target[macro]]);
      const reparto = totals[macro];
      if (!Number.isFinite(objetivo) || objetivo <= 0) {
        log(`  ${macro.padEnd(8)} reparto ${reparto}  ·  objetivo sin definir`);
        continue;
      }
      const diff = Math.round((reparto - objetivo) * 10) / 10;
      const pct = Math.round((diff / objetivo) * 1000) / 10;
      log(
        `  ${macro.padEnd(8)} reparto ${String(reparto).padStart(7)}  ` +
          `objetivo ${String(objetivo).padStart(7)}  ` +
          `${diff > 0 ? "+" : ""}${diff} (${pct > 0 ? "+" : ""}${pct}%)` +
          (Math.abs(pct) > 10 ? "   << DESCUADRA" : "")
      );
    }

    // Un grupo libre no suma y está bien que no sume: se dice como nota, no
    // como problema. Confundirlo con un agujero enseña a ignorar el aviso.
    if (free.length) {
      log(
        `  fuera del cuadre por ser libres: ` +
          free.map((row) => `${row.count}x ${row.groupName}`).join(", ")
      );
    }

    // La mitad importante: un total al que le faltan grupos parece correcto y
    // no lo es, así que nunca se da por bueno en silencio.
    if (incomplete.length) {
      log(
        `  NO CUADRABLE: ${incomplete.length} ración(es) sin perfil — ` +
          incomplete.map((row) => `${row.count}× ${row.groupName}`).join(", ")
      );
    }
  }
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  await mongoose.connect(mongoUri);

  await checkGroups();
  await checkGoals();

  await mongoose.disconnect();
  log("done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
