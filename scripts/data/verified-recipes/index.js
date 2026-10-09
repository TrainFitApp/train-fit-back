// Recetas verificadas ("de fábrica") que siembra scripts/seed-verified-recipes.js.
// Cada fichero es una sección del recetario; la despensa (pantry.js) dice a
// qué Product de la base de datos apunta cada ingrediente.

module.exports = {
  PANTRY: require("./pantry"),
  RECIPES: [
    ...require("./desayunos"),
    ...require("./aves"),
    ...require("./carnes"),
    ...require("./pescados"),
    ...require("./vegetarianas"),
    ...require("./snacks-postres"),
  ],
};
