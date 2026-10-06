const mongoose = require("mongoose");
const mongooseAutopopulate = require("mongoose-autopopulate");
const Schema = mongoose.Schema;
const DietMenuSchema = require("./diet-menu-schema");

const DIETARY_FLAGS = ["vegan", "vegetarian", "lactoseFree", "glutenFree"];

// Plantilla de dieta de la BIBLIOTECA del profesional: se construye una vez y
// se aplica a N clientes. Aplicarla nunca asigna la plantilla en sí: crea una
// fase (dietPhases/diet-phase-schema.js) con una copia independiente de sus
// menús, así que editar o borrar la plantilla después no toca a nadie.
//
// Tres sabores, todos material de biblioteca:
//   - general: aplicable a cualquier cliente del profesional;
//   - propia de un cliente (`ownerClientId`, "las dietas de Pepe"): solo se
//     ofrece para ese cliente;
//   - de fábrica (`verified`, solo admin): sale en las sugerencias de todos.
const DietTemplateSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    ownerClientId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    verified: { type: Boolean, default: false },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    menus: { type: [DietMenuSchema], default: [] },
    // Aptitud DERIVADA del contenido: "vegan" si TODOS sus alimentos lo son
    // (igual para el resto de flags; un flag sin rellenar no certifica). Se
    // recalcula en cada guardado (diet-template-dao.js), nunca se teclea.
    suitableFor: { type: [{ type: String, enum: DIETARY_FLAGS }], default: () => [] },
    // Aptitudes que el profesional FUERZA a mano cuando sabe que la dieta es
    // apta pese a productos sin el flag. La efectiva es la unión de las dos.
    suitableForOverride: { type: [{ type: String, enum: DIETARY_FLAGS }], default: () => [] },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "diettemplates" }
);

DietTemplateSchema.plugin(mongooseAutopopulate);

DietTemplateSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId", "ownerClientId"], authorship: ["assignedByTrainerId"] });

module.exports = mongoose.model("DietTemplate", DietTemplateSchema);
module.exports.DIETARY_FLAGS = DIETARY_FLAGS;
