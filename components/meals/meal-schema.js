const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const customProductSchema = require("../customProducts/custom-product-schema");
const customRecipeSchema = require("../customRecipes/custom-recipe-schema");

const MealSchema = Schema({
  name: { type: String, trim: true, maxlength: 100 },
  notes: { type: String, trim: true, maxlength: 500 },
  // TAREA 1 (coach-tab) — presente si un profesional pautó esta comida
  // (prescribeMeal). Mismo criterio que Table.assignedByTrainerId:
  // permanente, protege de edición directa del cliente (ver
  // meal-service.js#assertMealEditable) — la única vía controlada para
  // cambiarla es una MealProposal nueva del propio profesional.
  assignedByTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // El cliente la marca como comida cuando la ha tomado — no bloqueado por
  // assignedByTrainerId (marcar cumplimiento siempre está permitido, solo se
  // protege la COMPOSICIÓN de la comida, no su registro de seguimiento).
  completed: { type: Boolean, default: false },
  customProducts: [
    {
      type: Schema.Types.ObjectId,
      ref: "CustomProduct",
      autopopulate: true,
    },
  ],
  customRecipes: [
    {
      type: Schema.Types.ObjectId,
      ref: "CustomRecipe",
      autopopulate: true,
    },
  ],
  // Unificación mealSnippets -> meals (2026-08, mismo criterio que
  // workoutTemplates -> workouts) — un Meal con trainerId es un snippet
  // reutilizable del profesional (sin DietDay que lo referencie), nunca una
  // comida real de cliente. Único discriminador, nunca se reutiliza para
  // otro significado (p.ej. provenance ya tiene su propio campo:
  // assignedByTrainerId).
  trainerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  // Refactor nutrición (2026-09) — absorbe la colección `mealproposals`.
  // Vacío (el 99% del tiempo) = esta comida no tiene nada que elegir; con
  // 2+ entradas = el profesional propuso varias opciones para este hueco.
  //
  // NO se vacía al elegir: el selector del cliente es persistente (puede
  // alternar entre opciones cuantas veces quiera), así que las alternativas
  // se quedan y lo que cambia es `chosenAlternativeIndex`. Al elegir, la
  // opción escogida se materializa en customProducts/customRecipes vía
  // pasteMeal, igual que antes.
  //
  // Sigue siendo Mixed a propósito, igual que en la colección que sustituye:
  // es el formato "clipboard" que pasteMeal ya consume, y estas alternativas
  // NO son documentos reales hasta que se elige una — materializarlas todas
  // crearía CustomProducts que se borrarían al instante al cambiar de opción.
  alternatives: {
    type: [
      {
        label: { type: String, trim: true, maxlength: 100, required: true },
        customProducts: { type: [Schema.Types.Mixed], default: [] },
        customRecipes: { type: [Schema.Types.Mixed], default: [] },
        _id: false,
      },
    ],
    default: [],
  },
  // Opciones de comida (2026-09): con alternativas siempre está puesto —
  // la comida nace con la opción 1 aplicada (índice 0) y el cliente alterna
  // desde ahí. null = sin alternativas.
  chosenAlternativeIndex: { type: Number, default: null },
  // Quién propuso las alternativas (null si no hay ninguna) — era
  // MealProposal.trainerId; se conserva porque el cliente ve "te ha
  // propuesto tu entrenador" y porque pasteMeal necesita el trainerId para
  // marcar assignedByTrainerId al materializar la elegida.
  alternativesTrainerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  // Sustituye a DietException con mealSlot puesto y action:"override" —
  // "esta comida concreta se cambió respecto a lo pautado". El contenido del
  // cambio NO se guarda aparte: ya ES el customProducts/customRecipes real
  // de esta misma comida.
  wasOverridden: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

MealSchema.plugin(mongooseAutopopulate);

// Guardarraíl: toda query BROAD de Meal (sin _id ni trainerId propios)
// excluye snippets (trainerId set) por defecto — protege listados/búsquedas
// existentes (findAll, searchAllWithFilters) de colar snippets como si
// fueran comidas reales. Una consulta por _id concreto (incluida la que hace
// pasteMeal internamente, compartida con la creación de snippets) o que ya
// filtra por trainerId explícito no se toca — mismo criterio que
// workouts/workout-schema.js.
MealSchema.pre(/^find/, function (next) {
  const query = this.getQuery();
  if (query._id === undefined && query.trainerId === undefined) {
    this.where({ trainerId: null });
  }
  next();
});

const handleDelete = async function (next) {
  try {
    const query = this.getQuery();
    const meal = await this.model.findOne(query);
    if (!meal) return next();

    const customProductIds = meal.customProducts || [];
    const customRecipeIds = meal.customRecipes || [];

    // Perform deletions
    await customProductSchema.deleteMany({ _id: { $in: customProductIds } });
    await customRecipeSchema.deleteMany({
      _id: { $in: customRecipeIds },
    });

    next();
  } catch (error) {
    next(error);
  }
};

MealSchema.pre("deleteOne", handleDelete);
MealSchema.pre("findOneAndDelete", handleDelete);
MealSchema.pre("findOneAndRemove", handleDelete);

MealSchema.pre("deleteMany", async function (next) {
  try {
    const filter = this.getFilter();
    const mealsPToDelete = await this.model.find(filter, "customProducts");
    const mealsRToDelete = await this.model.find(
      filter,
      "customRecipes",
    );
    const customProductsIds = mealsPToDelete.flatMap(
      (meal) => meal.customProducts,
    );
    const customRecipeIds = mealsRToDelete.flatMap(
      (meal) => meal.customRecipes,
    );
    await customProductSchema.deleteMany({ _id: { $in: customProductsIds } });
    await customRecipeSchema.deleteMany({
      _id: { $in: customRecipeIds },
    });
    next();
  } catch (error) {
    next(error);
  }
});

module.exports = mongoose.model("Meal", MealSchema);
