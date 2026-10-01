const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Recientes que el cliente ha ocultado en el buscador de alimentos de una
// comida. Los recientes no se guardan en ningún sitio: se calculan al vuelo a
// partir del historial (diets/diet-dao.js#getRecentMealProducts). Aquí solo
// vive lo que hay que quitar de ese cálculo.
//
// Va por posición de comida (mealIndex, Desayuno = 0…) igual que el cálculo,
// y por tipo, porque productos y recetas son pestañas distintas.
const HiddenRecentFoodSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    mealIndex: { type: Number, required: true, min: 0 },
    kind: { type: String, enum: ["product", "recipe"], required: true },
    // Product o Recipe ocultado. null = «Borrar todos»: oculta todo lo que se
    // añadió a esa comida hasta hiddenAt.
    refId: { type: Schema.Types.ObjectId, default: null },
    // Lo añadido DESPUÉS de esta fecha vuelve a ser reciente (ver
    // hidden-recent-food-match.js).
    hiddenAt: { type: Date, required: true, default: Date.now },
  },
  { collection: "hiddenrecentfoods" }
);

HiddenRecentFoodSchema.index({ userId: 1, mealIndex: 1, kind: 1, refId: 1 }, { unique: true });

module.exports = mongoose.model("HiddenRecentFood", HiddenRecentFoodSchema);
