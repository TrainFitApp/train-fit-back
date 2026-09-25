const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const mongoose = require("mongoose");
const { buildMongoUri, redactMongoUri } = require("./_mongo-uri");

// Verificación del refactor de nutrición (2026-09): ejercita las rutas de
// código REALES (DAOs/servicios, no consultas sueltas escritas para la
// ocasión) contra los datos ya migrados.

const LOG = "[verify-nutrition-model]";
let failures = 0;
const check = (label, condition, detail = "") => {
  const mark = condition ? "OK  " : "FALLO";
  if (!condition) failures += 1;
  console.log(`${LOG} ${mark} ${label}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  await mongoose.connect(buildMongoUri());
  console.log(`${LOG} conectado ${redactMongoUri(buildMongoUri())}`);

  const dietDaysDao = require("../components/dietDays/diet-days-dao");
  const dietDaysService = require("../components/dietDays/diet-days-service");
  const mealProposalDao = require("../components/mealProposals/meal-proposal-dao");
  const { isDaySkipped, listSkippedDates } = require("../components/dietDays/diet-skips");
  const dietModel = require("../components/diets/diet-model");
  const dietDaySchema = require("../components/dietDays/diet-days-schema");

  // Un usuario real con días migrados.
  const sample = await dietDaySchema.findOne({ userId: { $exists: true } }).lean();
  const userId = sample.userId;
  const date = sample.date;
  console.log(`${LOG} usuario de prueba ${userId}, fecha ${date}`);

  // 1. El índice nuevo existe de verdad en Mongo.
  const indexes = await dietDaySchema.collection.indexes();
  const hasIndex = indexes.some(
    (i) => i.key && i.key.userId === 1 && i.key.date === 1
  );
  check("índice (userId, date) creado", hasIndex, JSON.stringify(indexes.map((i) => i.key)));

  // 2. Buscar el día por dueño+fecha (la consulta que antes cargaba todo el
  //    historial en memoria).
  const day = await dietDaysDao.findByUserAndDate(userId, date);
  check("findByUserAndDate encuentra el día", !!day && String(day._id) === String(sample._id));
  check("el día trae sus comidas pobladas", !!day && (day.meals || []).length > 0,
    day ? `${(day.meals || []).length} comidas` : "");

  // 3. Rango por dueño (agregación reescrita).
  const range = await dietDaysDao.getDietDaysBetweenDatesByUser(userId, "2000-01-01", "2100-01-01");
  check("getDietDaysBetweenDatesByUser devuelve días", Array.isArray(range) && range.length > 0,
    `${range.length} días`);
  check("devuelve la lista directa, no envuelta en {dietDays}", !range[0]?.dietDays);

  // 4. Días completamente poblados (los usa el entrenador y la lista de la compra).
  const populated = await dietDaysDao.getFullyPopulatedDietDaysForUser(userId, "2000-01-01", "2100-01-01");
  check("getFullyPopulatedDietDaysForUser devuelve días", populated.length > 0, `${populated.length} días`);

  // 5. Alternativas de comida (antes colección mealproposals).
  const withAlternatives = await dietDaySchema
    .findOne({ userId: { $exists: true } })
    .populate({ path: "meals", match: { "alternatives.0": { $exists: true } } })
    .lean();
  const anyMealDoc = await mongoose.connection
    .collection("meals")
    .findOne({ "alternatives.0": { $exists: true } });
  if (anyMealDoc) {
    const ownerDay = await mongoose.connection
      .collection("dietdays")
      .findOne({ meals: anyMealDoc._id });
    const proposals = await mealProposalDao.listForClientAndDate(ownerDay.userId, ownerDay.date);
    check("listForClientAndDate devuelve las alternativas migradas", proposals.length > 0,
      `${proposals.length} propuestas`);
    check("cada propuesta expone el id de su Meal",
      proposals.every((p) => !!p._id && Array.isArray(p.alternatives)));
    const found = await mealProposalDao.findById(anyMealDoc._id);
    check("findById resuelve una propuesta por id de Meal", !!found && !!found.mealSlot);
  } else {
    check("hay comidas con alternativas migradas", false, "ninguna encontrada");
  }

  // 6. Días saltados (antes colección dietexceptions) sobre el registro real.
  const skippedDay = await mongoose.connection
    .collection("dietdays")
    .findOne({ skipped: true });
  if (skippedDay) {
    check("isDaySkipped ve el día saltado", await isDaySkipped(skippedDay.userId, skippedDay.date));
    const history = await listSkippedDates(skippedDay.userId);
    check("listSkippedDates (historial TASK-045) sigue devolviendo datos", history.length > 0,
      `${history.length} fechas`);
  } else {
    check("hay días marcados como saltados", false, "ninguno encontrado");
  }

  // 7. Capa de compatibilidad de /diets (la que siguen llamando las apps).
  const compat = await dietModel.getDietById(userId);
  check("GET /diets/:id devuelve forma compatible",
    !!compat && "pinnedNote" in compat && Array.isArray(compat.dietsDay));

  const noteBack = await dietModel.updatePinnedNote(userId, "prueba refactor");
  check("PATCH pinned-note escribe en el usuario", noteBack?.pinnedNote === "prueba refactor");
  await dietModel.updatePinnedNote(userId, "");

  // 8. countDaysWithoutChoice, que antes filtraba en memoria.
  const stuck = await dietDaysService.countDaysWithoutChoice(userId, "2000-01-01", "2100-01-01");
  check("countDaysWithoutChoice responde un número", typeof stuck === "number", `${stuck}`);

  console.log("");
  console.log(`${LOG} ${failures === 0 ? "TODO OK" : `${failures} COMPROBACIONES FALLIDAS`}`);

  await mongoose.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(LOG, "ERROR", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
