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
// 2026-09 — una plantilla es SIEMPRE una lista de MENÚS: días
// intercambiables ("Entrenamiento", "Descanso"…) entre los que el cliente
// elige cada día. Los otros dos modos que existían (una secuencia Día 1..N
// desde una fecha de inicio, y patrones atados a días de la semana) se han
// eliminado: ninguno aportaba nada que un menú no cubra y triplicaban el
// camino de resolución, el editor y las etiquetas.
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
    // null (todo documento anterior a este campo lo es implícitamente) =
    // plantilla real reutilizable del entrenador. Puesto = copia congelada
    // exclusiva de UNA asignación (ver diet-template-dao.js#cloneForAssignment):
    // mismo shape, misma colección, para no duplicar el modelo de datos, pero
    // nunca aparece en listByTrainer ni se vuelve a asignar a nadie — la regla
    // del producto es que a un cliente jamás se le asigna la plantilla en sí.
    clientId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    // Dueño de una plantilla REUTILIZABLE acotada a un cliente ("las dietas
    // de Pepe"), distinto de `clientId` de arriba: aquí no hay fechas ni
    // status, esto no rige nada — es material de biblioteca que solo tiene
    // sentido para ese cliente, y se aplica como fase igual que cualquier
    // otra plantilla (creando entonces su copia con clientId puesto).
    //
    // Campo aparte y no un `clientId` con status null a propósito: ese campo
    // ya significa "esto ES una asignación congelada" en el resolver de
    // fases, en su índice compuesto y en listByTrainer. Mezclar los dos
    // conceptos en un campo obligaría a auditar cada consulta que hoy da por
    // hecho "clientId puesto = asignación".
    //
    // Invariante: nunca puestos los dos a la vez. clientId puesto = copia
    // asignada (puede venir de una plantilla general o de una propia);
    // ownerClientId puesto = plantilla propia sin asignar.
    //
    // Sin `default: null` a propósito: en una plantilla general el campo
    // directamente NO EXISTE en el documento, en vez de guardarse como null.
    // Las consultas no cambian — en MongoDB `{campo: null}` y `$in:[x,null]`
    // casan igual con "null explícito" que con "campo ausente" — así que
    // listByTrainer sigue funcionando para los documentos anteriores a este
    // campo, que tampoco lo tienen.
    ownerClientId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    // Simplificación (2026-09) — la copia ES la asignación, ya no hay una
    // colección PlanAssignment aparte: una copia (clientId puesto) es 1:1 con
    // "este cliente tiene este plan desde tal fecha", así que sus campos de
    // fecha/estado viven aquí directo, no en un documento propio. En una
    // plantilla (sin clientId) no significan nada y por eso NO EXISTEN en el
    // documento — ninguno lleva `default: null`, así que solo aparecen donde
    // tienen sentido: las escribe explícitamente quien crea la asignación
    // (cloneForAssignment / createDirectAssignment). endMode determina cómo se
    // calculó endDate al asignar: "fixedDate" = fecha exacta elegida,
    // "duration" = startDate + N días (ya calculada), "indefinite" = endDate
    // null, sigue vigente hasta que se sustituya.
    //
    // Ojo con endDate: ahí null SÍ es un valor con significado ("indefinido",
    // ver blocksNewPhase en plan-assignment-service.js), no un hueco — una
    // asignación lo escribe siempre, incluso null.
    startDate: { type: String }, // "YYYY-MM-DD"
    // Fin REAL. null mientras la fase sigue corriendo; se estampa el día en
    // que otra fase la corta (markSuperseded). No hay fin estimado ni
    // duración: una fase acaba cuando empieza la siguiente
    // (docs/plan-revisiones.md).
    endDate: { type: String }, // "YYYY-MM-DD" o null si sigue vigente
    status: { type: String, enum: ["active", "superseded", "ended", null] },
    // Encadena con la copia que la sustituyó — permite reconstruir el
    // historial de fases sin perder rastro de lo que regía antes. Ausente
    // mientras no la sustituya nada (se escribe en markSuperseded).
    supersededBy: { type: Schema.Types.ObjectId, ref: "DietTemplate" },
    // Informativo — de qué plantilla se copió, solo para "ver plantilla
    // aplicada" en el frontend. Nunca se lee para resolver contenido (eso ya
    // es la copia en sí) ni para los `menus` reales.
    // Puede quedar huérfano si la plantilla original se borra después, y
    // está ausente en una asignación creada de cero ("Crear dieta"), que no
    // sale de ninguna plantilla.
    sourceTemplateId: { type: Schema.Types.ObjectId, ref: "DietTemplate" },

    // --- Fase / revisiones (sugerencias de dieta + progresión) ---
    //
    // Vocabulario: una **fase** (Hipertrofia, Minicut, Definición...) es un
    // periodo del plan del cliente, partido en **revisiones** por sus
    // check-ins (docs/plan-revisiones.md). Solo se persiste el CONTENIDO que
    // cambia: el primer documento de la fase y cada vez que el entrenador
    // prepara la revisión siguiente con comida o cantidades distintas.
    // Todos estos campos SOLO existen en copias (clientId puesto) — en una
    // plantilla de biblioteca no significan nada, igual que startDate/status.
    //
    // `phaseId` apunta al PRIMER documento de la fase (auto-ref, mismo patrón
    // que supersededBy), que se apunta a sí mismo. find({phaseId}) devuelve
    // toda la fase; renombrarla = tocar 1 doc.
    phaseId: { type: Schema.Types.ObjectId, ref: "DietTemplate", index: true },
    // Nombre de la FASE — solo en el primer documento, se lee vía phaseId
    // desde los demás.
    phaseName: { type: String, trim: true, maxlength: 100 },
    // Objetivo con el que se pauta la fase: el valor calculado del cliente,
    // o el que el entrenador tecleó encima (`source: "manual"`). Sustituye
    // al trío enfoque + ajuste de kcal + ritmo por revisión: lo que importa es
    // con qué números se pauta, no de qué preset salieron.
    phaseTarget: {
      type: new Schema(
        {
          kcal: Number,
          protein: Number,
          carbs: Number,
          fat: Number,
          source: { type: String, enum: ["calculated", "manual"], default: "calculated" },
        },
        { _id: false }
      ),
      default: undefined,
    },
    // g/kg de proteína y grasa que el entrenador fijó en el cajón al empezar
    // la fase (null = fórmula por defecto de nutrition-target.js). Solo el
    // primer documento; las revisiones recalculan con estos mismos.
    phaseProteinPerKg: { type: Number, default: null },
    phaseFatPerKg: { type: Number, default: null },
    // Cómo se calculó la necesidad del cliente al empezar la fase: snapshot
    // de los datos que entraron (peso y de dónde, altura, edad, sexo, rango
    // de pasos del hábito cumplido, entrenamiento, g/kg) y del desglose (BMR, factor,
    // gasto, kcal y macros). Solo en el head; las revisiones siguientes se
    // calculan al vuelo a su fecha de inicio.
    // `missing` con contenido = no se pudo calcular (faltaban biométricos).
    phaseNeed: {
      type: new Schema(
        {
          computedAt: Date,
          missing: { type: [String], default: undefined },
          inputs: Schema.Types.Mixed,
          breakdown: Schema.Types.Mixed,
          target: Schema.Types.Mixed,
          stepsFromHabit: Schema.Types.Mixed,
        },
        { _id: false }
      ),
      default: undefined,
    },
    // Las kcal de una revisión no se guardan: se derivan de los alimentos
    // (diet-macro-profile.js). Sus FECHAS tampoco: las marcan los check-ins
    // programados del cliente (revision-window.js).

    // --- Aptitud dietética ---
    //
    // `suitableFor` es DERIVADO del contenido: la plantilla lleva "vegan" si
    // TODOS sus CustomProduct tienen vegan === true (igual para vegetarian /
    // lactoseFree / glutenFree). Se recalcula en cada guardado
    // (diet-template-dao.js), nunca se teclea. Un flag `null` en un producto = "desconocido",
    // no certifica.
    suitableFor: { type: [String], default: () => [] },
    // Aptitudes que el entrenador FUERZA a mano cuando sabe que la dieta es
    // apta pese a productos con el flag sin rellenar. La efectiva que ve el
    // filtro = union(suitableFor, suitableForOverride).
    suitableForOverride: { type: [String], default: () => [] },
    // true = dieta predefinida de administración (mismo patrón que
    // Product.verified / Recipe.verified). Sale en el ranking de sugerencias
    // de todos los entrenadores. Ausente / false = dieta del entrenador.
    verified: { type: Boolean, default: false },

    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Los menús entre los que el cliente elige cada día. El nombre es libre
    // ("Entrenamiento", "Descanso") y es la CLAVE de la elección: se guarda
    // en DietDay.menuName, así que dos menús de la misma plantilla no pueden
    // llamarse igual (validado en el controller).
    menus: [
      {
        name: { type: String, trim: true, maxlength: 50, required: true },
        meals: [MealStructureSchema],
      },
    ],
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "diettemplates" }
);

DietTemplateSchema.plugin(mongooseAutopopulate);

// Resolver "¿qué plan rige hoy para este cliente?" es la consulta más
// frecuente sobre las copias — un índice compuesto la deja en O(log n) en
// vez de escanear toda la colección (plantillas incluidas).
DietTemplateSchema.index({ clientId: 1, status: 1, startDate: 1 });

// Recorre los menús y junta los ids de CustomProduct/CustomRecipe
// referenciados en TODO el documento — usado tanto por la cascada de borrado
// de aquí abajo como por diet-template-dao.js#update para limpiar el
// contenido viejo que se reemplaza (expuesto como propiedad del modelo, no
// como export aparte, para no crear un require circular schema<->dao).
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
  return collectIdsFromMeals(doc?.menus);
}

async function deleteContentIds({ productIds, recipeIds }) {
  if (productIds.length) await customProductSchema.deleteMany({ _id: { $in: productIds } });
  if (recipeIds.length) await customRecipeSchema.deleteMany({ _id: { $in: recipeIds } });
}

// Refactor nutrición (2026-09) — no hay nada más que arrastrar: saltarse un
// día es una marca en el DietDay real del cliente (skipped), y ese documento
// es suyo, no de la asignación: sigue siendo su historial aunque el plan que
// regía entonces se borre.
const handleDeleteOne = async function (next) {
  try {
    const doc = await this.model.findOne(this.getQuery());
    if (doc) {
      await deleteContentIds(collectContentIds(doc));
    }
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
    const assignmentIds = [];
    for (const doc of docs) {
      const ids = collectContentIds(doc);
      productIds.push(...ids.productIds);
      recipeIds.push(...ids.recipeIds);
      if (doc.clientId) assignmentIds.push(doc._id);
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
