const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Sugerencias de dieta + progresión (2026) — backfill de fase/ciclo.
//
// Lo que antes era "una fase" (una copia congelada suelta) pasa a ser un
// CICLO, y una FASE es un grupo de ciclos con el mismo phaseId. Para los
// datos que ya existen:
//   · Cada copia (clientId puesto) sin phaseId → fase de 1 ciclo:
//       phaseId = self._id, phaseName = name, phaseFocus = null
//       (no se deduce: el histórico no dice si era déficit o superávit).
//   · cycleTargetKcal/Macros ← del NutritionalGoal en uso del cliente, si
//     sus fechas cubren el inicio del ciclo; si no, se deja vacío
//     (la sugerencia del siguiente ciclo lo trata como "sin dato base").
//   · suitableFor de TODAS las diettemplates (plantillas y copias) se
//     recalcula desde el contenido.
//
// Uso:
//   node scripts/migrate-diet-phases.js --dry-run
//   node scripts/migrate-diet-phases.js

const DRY_RUN = process.argv.includes("--dry-run");
const LOG = "[migrate-diet-phases]";
const log = (...a) => console.log(LOG, ...a);

async function main() {
  const uri = buildMongoUri();
  log(`connecting ${redactMongoUri(uri)}  dryRun=${DRY_RUN}`);
  await mongoose.connect(uri);
  log("connected");

  const DietTemplate = require("../components/dietTemplates/diet-template-schema");
  const NutritionalGoal = require("../components/nutritionalGoals/nutritional-goal-schema");
  const { deriveSuitability } = require("../components/dietTemplates/diet-suitability");
  const { cycleMacroProfile } = require("../components/dietTemplates/diet-macro-profile");

  // 1) Fase/ciclo en las copias sin phaseId.
  const copies = await DietTemplate.find({ clientId: { $ne: null }, phaseId: { $in: [null, undefined] } });
  log(`copias sin phaseId: ${copies.length}`);
  let phased = 0;
  for (const copy of copies) {
    const goal = await NutritionalGoal.findOne({
      userId: copy.clientId,
      assignedByTrainerId: { $ne: null },
    })
      .sort({ createdAt: -1 })
      .lean();
    const profile = cycleMacroProfile(copy.toObject());

    const set = {
      phaseId: copy._id,
      phaseName: copy.name,
      phaseFocus: null,
      cycleTargetKcal: goal?.kcalTotal || profile.kcal || null,
      cycleTargetMacros: goal
        ? { protein: goal.proteinsGTotal, carbs: goal.carbohydratesGTotal, fat: goal.fatGTotal }
        : { protein: profile.protein, carbs: profile.carbs, fat: profile.fat },
    };
    if (!DRY_RUN) await DietTemplate.updateOne({ _id: copy._id }, { $set: set });
    phased += 1;
  }
  log(`${phased} copias convertidas en fase de 1 ciclo`);

  // 2) Recalcular suitableFor de todo.
  const all = await DietTemplate.find({});
  let suit = 0;
  for (const doc of all) {
    const { suitableFor } = deriveSuitability(doc.toObject());
    const current = (doc.suitableFor || []).slice().sort().join(",");
    if (current === suitableFor.slice().sort().join(",")) continue;
    if (!DRY_RUN) await DietTemplate.updateOne({ _id: doc._id }, { $set: { suitableFor } });
    suit += 1;
  }
  log(`suitableFor recalculado en ${suit}/${all.length} documentos`);

  await mongoose.disconnect();
  log("done");
}

main().catch(async (error) => {
  console.error(LOG, "fatal", error);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  process.exitCode = 1;
});
