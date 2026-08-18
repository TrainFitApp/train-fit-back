const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");

// Replanteamiento MVP (nutrición) — plantilla de dieta reutilizable del
// profesional, mismo espíritu que las plantillas de Table (rutinas): se
// construye una vez y se aplica a N clientes en vez de teclear cada comida
// de cada cliente de cada día a mano.
//
// 2026-08 — `customProducts`/`customRecipes` de cada alternativa dejaron de
// ser `Mixed` (blob crudo sin validar) para ser refs REALES a CustomProduct/
// CustomRecipe, mismo criterio que ya se aplicó a mealSnippets -> meals: la
// app entera ya tiene una única forma de representar "producto en un plato"
// (autopopulate + cascada de borrado), y un blob Mixed aparte solo duplicaba
// esa forma sin aportar nada — se materializan al crear/actualizar la
// plantilla (diet-template-dao.js), no al aplicar como antes.
// Auditoría de arquitectura (nutrición) — `mode` generaliza esta plantilla en
// tres formas de repetirse, sin romper nada de lo existente:
//   - "sequential" (default, TODO documento existente lo es): el `days[]` de
//     siempre — una secuencia finita "Día 1, Día 2…" que se aplica a partir
//     de una fecha de inicio, un día calendario por índice.
//   - "recurring": en vez de una secuencia finita, `dayPatterns[]` particiona
//     los 7 días de la semana (p. ej. "Entreno" L-V, "Descanso" S-D) — lo que
//     varía es el DÍA DE LA SEMANA, no una posición en una secuencia.
//   - "choice" (Fase 9): igual que "recurring" pero SIN día de la semana fijo
//     — el propio cliente elige, día a día, cuál de los `dayPatterns[]` le
//     toca (p. ej. "Entrenamiento" / "Descanso", ninguno atado a L-M-X...).
//     `appliesTo` no se usa en este modo.
// Un documento nunca usa `days` y `dayPatterns` a la vez — el campo que no
// corresponde al `mode` actual queda vacío.
//
// Fase 9 — cada comida admite VARIAS alternativas (antes un único
// customProducts/customRecipes por slot). 0 alternativas = comida vacía; 1 =
// sin elección (comportamiento de siempre); 2+ = el cliente elige cuál comer
// ese día, vía una MealProposal generada automáticamente al resolver el plan
// (ver diet-day-resolver.js#applyResolvedPlanToDietDay) — mismo shape
// {label, customProducts, customRecipes} que ya usa mealProposals/
// meal-proposal-schema.js, reutilizado aquí en vez de reinventado.
const MealAlternativeSchema = {
  label: { type: String, trim: true, maxlength: 100, default: "" },
  customProducts: [{ type: Schema.Types.ObjectId, ref: "CustomProduct", autopopulate: true }],
  customRecipes: [{ type: Schema.Types.ObjectId, ref: "CustomRecipe", autopopulate: true }],
};

const MealStructureSchema = {
  // Debe coincidir con diet-days-util.js#MEALS (Desayuno/Almuerzo/Comida/
  // Merienda/Cena/Recena) para resolverse contra el DietDay real del cliente.
  slot: { type: String, required: true, trim: true, maxlength: 50 },
  alternatives: { type: [MealAlternativeSchema], default: [] },
};

const DietTemplateSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    mode: { type: String, enum: ["sequential", "recurring", "choice"], default: "sequential" },
    days: [
      {
        // Etiqueta libre ("Día 1", "Lunes") — NO atada a una fecha real; la
        // fecha real se decide al aplicar la plantilla a un cliente.
        dayLabel: { type: String, trim: true, maxlength: 50, required: true },
        meals: [MealStructureSchema],
      },
    ],
    // Solo relevante si mode === "recurring".
    dayPatterns: [
      {
        name: { type: String, trim: true, maxlength: 50, required: true },
        // Índices de día de la semana que cubre este patrón: 0=domingo … 6=sábado
        // (mismo criterio que Date#getDay()). La unión de todos los patrones de
        // una plantilla debería cubrir 0-6 sin solapes — validado en el
        // controller, no aquí (Mongoose no valida invariantes entre elementos
        // de un array con facilidad).
        appliesTo: { type: [Number], default: [] },
        meals: [MealStructureSchema],
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "diettemplates" }
);

DietTemplateSchema.plugin(mongooseAutopopulate);

// Recorre days[] y dayPatterns[] (mismo shape .meals[].alternatives[]) y
// junta los ids de CustomProduct/CustomRecipe referenciados en TODO el
// documento — usado tanto por la cascada de borrado de aquí abajo como por
// diet-template-dao.js#update para limpiar el contenido viejo que se
// reemplaza (expuesto como propiedad del modelo, no como export aparte, para
// no crear un require circular schema<->dao).
function collectIdsFromMeals(containers) {
  const productIds = [];
  const recipeIds = [];
  for (const container of containers || []) {
    for (const meal of container.meals || []) {
      for (const alt of meal.alternatives || []) {
        productIds.push(...(alt.customProducts || []));
        recipeIds.push(...(alt.customRecipes || []));
      }
    }
  }
  return { productIds, recipeIds };
}

function collectContentIds(doc) {
  const fromDays = collectIdsFromMeals(doc?.days);
  const fromPatterns = collectIdsFromMeals(doc?.dayPatterns);
  return {
    productIds: [...fromDays.productIds, ...fromPatterns.productIds],
    recipeIds: [...fromDays.recipeIds, ...fromPatterns.recipeIds],
  };
}

async function deleteContentIds({ productIds, recipeIds }) {
  if (productIds.length) await customProductSchema.deleteMany({ _id: { $in: productIds } });
  if (recipeIds.length) await customRecipeSchema.deleteMany({ _id: { $in: recipeIds } });
}

const handleDeleteOne = async function (next) {
  try {
    const doc = await this.model.findOne(this.getQuery());
    if (doc) await deleteContentIds(collectContentIds(doc));
    next();
  } catch (error) {
    next(error);
  }
};

DietTemplateSchema.pre("deleteOne", handleDeleteOne);
DietTemplateSchema.pre("findOneAndDelete", handleDeleteOne);
DietTemplateSchema.pre("findOneAndRemove", handleDeleteOne);

DietTemplateSchema.pre("deleteMany", async function (next) {
  try {
    const docs = await this.model.find(this.getFilter());
    const productIds = [];
    const recipeIds = [];
    for (const doc of docs) {
      const ids = collectContentIds(doc);
      productIds.push(...ids.productIds);
      recipeIds.push(...ids.recipeIds);
    }
    await deleteContentIds({ productIds, recipeIds });
    next();
  } catch (error) {
    next(error);
  }
});

const DietTemplateModel = mongoose.model("DietTemplate", DietTemplateSchema);
DietTemplateModel.collectContentIds = collectContentIds;

module.exports = DietTemplateModel;
