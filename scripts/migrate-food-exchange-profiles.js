const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");
// `populate` de items.productId resuelve el modelo por su nombre, y en un
// script no hay arranque de app que lo haya registrado antes.
require("../components/products/product-schema");
const {
  MACROS,
  computeServing,
  hasServing,
  isCompleteServing,
} = require("../components/foodExchanges/exchange-profile");

// El perfil de una ración (2026-09) — FoodExchangeGroup pasa de declarar UN
// macro (`basis` + `basisAmount`) a declarar los cuatro (`anchor` +
// `serving`), y GoalMealExchange se queda con una copia congelada del perfil
// que regía al pautar.
//
// El porqué: con una sola cifra por grupo, el reparto del día no se puede
// comparar contra las kcal ni contra los otros dos macros del objetivo. El
// cuadre no era difícil, era imposible — faltaba el dato.
//
// Qué respeta esta migración, y por qué:
//
//   1. Lo que el entrenador escribió gana SIEMPRE. Si un grupo tenía
//      `basisAmount: 20` con `basis: "protein"`, el perfil sale con
//      `protein: 20` exacto y `servingSource: "manual"`. Los otros tres
//      macros se rellenan desde los productos vinculados, que es información
//      que él no tenía forma de escribir.
//   2. Nada se inventa. Un grupo sin `basis` NO recibe un `anchor` deducido:
//      el criterio de equivalencia es una decisión suya, y elegirla por él
//      sería justo lo que este componente lleva desde el principio evitando.
//      Se queda con el perfil calculado y sin anchor, que es un estado
//      visible ("sin criterio declarado"), no un hueco.
//   3. Lo que no se puede calcular se marca, no se rellena con ceros. Un
//      grupo sin ningún alimento vinculado queda `freeQuantity: true` y fuera
//      del cuadre, diciéndolo.
//   4. `basis`/`basisAmount` NO se borran: las apps publicadas los leen. El
//      controlador los deriva del perfil en cada escritura, así que no pueden
//      divergir. Se retiran cuando las tiendas hayan rotado.
//
// Es idempotente: solo toca documentos a los que les falta el campo, salvo
// que se pida --recompute.
//
// Uso:
//   node scripts/migrate-food-exchange-profiles.js --dry-run
//   node scripts/migrate-food-exchange-profiles.js
//   node scripts/migrate-food-exchange-profiles.js --recompute

const hasFlag = (flag) => process.argv.includes(flag);
const DRY_RUN = hasFlag("--dry-run");
const RECOMPUTE = hasFlag("--recompute");
// El detalle por grupo es lo que hace útil el modo seco con 4 grupos y lo que
// lo hace ilegible con 400.
const SUMMARY_ONLY = hasFlag("--summary");

const LOG_PREFIX = "[migrate-food-exchange-profiles]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

const PRODUCT_MACROS = "energyKcal100g protein100g carbohydrates100g fat100g";

/**
 * El perfil que le toca a un grupo.
 *
 * Devuelve también `note`, que es lo que se imprime en seco: una migración
 * que solo dice "42 documentos actualizados" no permite revisar si hizo lo
 * correcto antes de dejarla correr sobre datos reales.
 */
function planFor(group) {
  const { serving: computed, computedFrom, total } = computeServing(group.items);
  const serving = { ...computed };

  // El número del entrenador manda sobre el calculado, en el macro que él
  // eligió igualar. El catálogo puede estar mal; su criterio no se discute.
  const declared = Number(group.basisAmount);
  const anchor = group.basis || null;
  const isManual = !!anchor && Number.isFinite(declared) && declared > 0;
  if (isManual) serving[anchor] = declared;

  // Un `freeQuantity` ya marcado se respeta: solo el entrenador sabe que un
  // grupo no se pesa, y con sus alimentos vinculados el perfil SÍ se calcula
  // —- deducirlo de "no hay perfil" lo perdería.
  const freeQuantity = group.freeQuantity === true || (!isManual && !hasServing(serving));

  return {
    anchor,
    serving,
    servingSource: isManual ? "manual" : "computed",
    freeQuantity,
    // Los legacy se derivan del perfil, nunca al revés. Sin anchor no hay
    // basis: inventarlo cambiaría lo que la app publicada le enseña hoy.
    basis: anchor,
    basisAmount: anchor && Number.isFinite(Number(serving[anchor])) ? Number(serving[anchor]) : null,
    note:
      `${group.name} — ` +
      (freeQuantity
        ? "sin perfil (libre): ningún alimento vinculado"
        : `${isManual ? "manual" : "calculado"} ${anchor || "sin anchor"} ` +
          `[${MACROS.map((m) => `${m}:${serving[m] === null ? "—" : serving[m]}`).join(" ")}] ` +
          `de ${computedFrom}/${total} alimentos` +
          (isCompleteServing(serving) ? "" : "  << PERFIL INCOMPLETO, no cuadra el día")),
  };
}

async function migrateGroups() {
  const FoodExchangeGroup = require("../components/foodExchanges/food-exchange-schema");

  const filter = RECOMPUTE ? {} : { serving: { $exists: false } };
  const groups = await FoodExchangeGroup.find(filter)
    .populate({ path: "items.productId", select: PRODUCT_MACROS })
    .lean();

  log(`grupos a revisar: ${groups.length}${RECOMPUTE ? " (--recompute)" : ""}`);

  const ops = [];
  const profiles = new Map();
  const stats = { manual: 0, computed: 0, free: 0, incomplete: 0, skippedManual: 0 };

  for (const group of groups) {
    // Con --recompute, un perfil que el entrenador declaró manual no se
    // toca: recalcularlo pisaría su decisión en silencio, que es justo lo
    // contrario de lo que hace falta.
    if (RECOMPUTE && group.servingSource === "manual" && group.serving) {
      stats.skippedManual += 1;
      continue;
    }

    const plan = planFor(group);
    profiles.set(String(group._id), { serving: plan.serving, freeQuantity: plan.freeQuantity });

    if (plan.freeQuantity) stats.free += 1;
    else if (plan.servingSource === "manual") stats.manual += 1;
    else stats.computed += 1;
    if (!plan.freeQuantity && !isCompleteServing(plan.serving)) stats.incomplete += 1;

    if (!SUMMARY_ONLY) log(`  ${plan.note}`);

    // Los campos LEGACY solo se reescriben cuando hay anchor, y entonces con
    // EXACTAMENTE el mismo valor que ya tenían. Sin anchor no se tocan: meter
    // `basis: null` en el $set borraría un `basisAmount` huérfano y rompería
    // la única garantía que hace reversible esta migración — que volver al
    // backend anterior deja los datos como estaban.
    const legacy = plan.anchor
      ? { basis: plan.basis, basisAmount: plan.basisAmount }
      : {};

    ops.push({
      updateOne: {
        filter: { _id: group._id },
        update: {
          $set: {
            anchor: plan.anchor,
            serving: plan.serving,
            servingSource: plan.servingSource,
            freeQuantity: plan.freeQuantity,
            ...legacy,
            // Explícito y no por el default del schema: los documentos que ya
            // existen no pasan por el default nunca, y un grupo sin
            // tolerancia no se podría verificar.
            tolerancePct: Number.isFinite(group.tolerancePct) ? group.tolerancePct : 10,
            updatedAt: new Date(),
          },
        },
      },
    });
  }

  if (ops.length && !DRY_RUN) {
    const result = await FoodExchangeGroup.collection.bulkWrite(ops, { ordered: false });
    ok(`grupos actualizados=${result.modifiedCount || 0}`);
  } else {
    ok(`grupos que se actualizarían=${ops.length}`);
  }
  const trainers = new Set(groups.map((group) => String(group.trainerId)));
  ok(
    `resumen grupos: manual=${stats.manual} calculado=${stats.computed} ` +
      `libres=${stats.free} incompletos=${stats.incomplete} intactos=${stats.skippedManual}`
  );
  // Lo que de verdad decide si esto se lanza un martes o un viernes: cuánta
  // gente va a abrir su biblioteca y ver grupos marcados como incompletos.
  ok(`entrenadores afectados: ${trainers.size}`);

  return profiles;
}

/**
 * Congela el perfil en los repartos ya pautados.
 *
 * Se lee de `profiles` (lo que acaba de calcular el paso anterior) y no de la
 * base de datos, para que --dry-run enseñe el resultado real en vez de los
 * documentos sin migrar. Los grupos que no estaban en ese paso —porque ya
 * tenían perfil— se leen aparte.
 */
async function freezeGoals(profiles) {
  const NutritionalGoal = require("../components/nutritionalGoals/nutritional-goal-schema");
  const FoodExchangeGroup = require("../components/foodExchanges/food-exchange-schema");

  const goals = await NutritionalGoal.find({ "mealExchanges.0": { $exists: true } })
    .select("name userId mealExchanges")
    .lean();

  log(`objetivos con reparto: ${goals.length}`);
  if (!goals.length) return;

  // Los grupos que el paso anterior no tocó (ya tenían perfil) hacen falta
  // igual para congelar: se piden solo los que falten.
  const referenced = new Set();
  for (const goal of goals) {
    for (const meal of goal.mealExchanges || []) {
      for (const exchange of meal.exchanges || []) referenced.add(String(exchange.groupId));
    }
  }
  const missing = [...referenced].filter((id) => !profiles.has(id));
  if (missing.length) {
    const rest = await FoodExchangeGroup.find({ _id: { $in: missing } })
      .select("serving freeQuantity")
      .lean();
    for (const group of rest) {
      profiles.set(String(group._id), { serving: group.serving || null, freeQuantity: !!group.freeQuantity });
    }
  }

  const now = new Date();
  const ops = [];
  const stats = { frozen: 0, free: 0, alreadyFrozen: 0, noProfile: 0, missingGroup: 0 };

  for (const goal of goals) {
    let touched = false;
    const meals = (goal.mealExchanges || []).map((meal) => ({
      ...meal,
      exchanges: (meal.exchanges || []).map((exchange) => {
        if (!RECOMPUTE && exchange.servingFrozenAt) {
          stats.alreadyFrozen += 1;
          return exchange;
        }
        const key = String(exchange.groupId);
        if (!profiles.has(key)) {
          // El grupo se borró después de pautar. La pauta se deja tal cual:
          // el cliente sigue leyendo "2 raciones de Proteína" y la pantalla
          // ya sabe decir que ese grupo no está disponible. Borrarla aquí le
          // quitaría parte de su pauta sin explicación.
          stats.missingGroup += 1;
          return exchange;
        }
        const { serving, freeQuantity } = profiles.get(key);
        if (freeQuantity) {
          touched = true;
          stats.free += 1;
          return { ...exchange, freeQuantity: true, servingFrozenAt: now };
        }
        if (!isCompleteServing(serving)) {
          stats.noProfile += 1;
          return exchange;
        }
        touched = true;
        stats.frozen += 1;
        return { ...exchange, serving, servingFrozenAt: now };
      }),
    }));

    if (!touched) continue;
    ops.push({
      updateOne: {
        filter: { _id: goal._id },
        update: { $set: { mealExchanges: meals, updatedAt: now } },
      },
    });
  }

  if (ops.length && !DRY_RUN) {
    const result = await NutritionalGoal.collection.bulkWrite(ops, { ordered: false });
    ok(`objetivos actualizados=${result.modifiedCount || 0}`);
  } else {
    ok(`objetivos que se actualizarían=${ops.length}`);
  }
  ok(
    `resumen raciones: congeladas=${stats.frozen} libres=${stats.free} ` +
      `ya congeladas=${stats.alreadyFrozen} ` +
      `sin perfil=${stats.noProfile} grupo borrado=${stats.missingGroup}`
  );
}

async function main() {
  const mongoUri = buildMongoUri();
  log(`connecting ${redactMongoUri(mongoUri)}`);
  log(`flags dryRun=${DRY_RUN} recompute=${RECOMPUTE} summary=${SUMMARY_ONLY}`);

  await mongoose.connect(mongoUri);
  ok("connected");

  const profiles = await migrateGroups();
  await freezeGoals(profiles);

  await mongoose.disconnect();
  ok(DRY_RUN ? "done (dry run, nada escrito)" : "done");
}

main().catch(async (error) => {
  console.error(LOG_PREFIX, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
