const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Replanteamiento MVP (nutrición) — plantilla de dieta reutilizable del
// profesional, mismo espíritu que las plantillas de Table (rutinas): se
// construye una vez y se aplica a N clientes en vez de teclear cada comida
// de cada cliente de cada día a mano. `customProducts`/`customRecipes` usan
// el mismo formato "clipboard" crudo que ya acepta `mealModel.pasteMeal`
// (ver F12/F28) — se materializan como documentos reales solo al aplicar la
// plantilla a un cliente (diet-template-controller.js#applyToClient).
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
  customProducts: { type: [Schema.Types.Mixed], default: [] },
  customRecipes: { type: [Schema.Types.Mixed], default: [] },
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

module.exports = mongoose.model("DietTemplate", DietTemplateSchema);
