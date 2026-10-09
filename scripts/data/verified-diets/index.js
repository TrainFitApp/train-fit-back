// Dietas de fábrica que siembra scripts/seed-verified-diets.js: plantillas de
// biblioteca con `verified: true` que salen a todos los profesionales en las
// sugerencias de dieta y en «De fábrica». Los alimentos son claves de la
// despensa de las recetas verificadas (verified-recipes/pantry.js), que apunta
// a Products reales de producción.
//
// Formato de cada dieta:
//   name     nombre de la plantilla (único entre las de fábrica)
//   menus    días intercambiables que el cliente elige cada día:
//            { name, target: { kcal, protein }, meals }
//   meals    { slot, alternatives } con `slot` de dietDays/diet-days-util.js#MEALS
//   alternatives  opciones del hueco (de 1 a 4): { label, foods: [[clave, gramos]] }
//
// Gramos en crudo y en seco (arroz, pasta, avena, legumbres secas); las
// legumbres cocidas, el pan y los lácteos tal cual se comen. Las opciones de
// una misma comida aportan casi lo mismo (energía ±12 % y proteína ±10 % de la
// media de la comida), así que elegir una u otra no descuadra el día. `target` es lo que se buscó al calcular las
// cantidades; el script compara cada menú con él usando los valores de la base.

module.exports = {
  PANTRY: require("../verified-recipes/pantry"),
  DIETS: [
    require("./definicion-1600"),
    require("./definicion-2000"),
    require("./mantenimiento-2400"),
    require("./volumen-2800"),
    require("./vegetariana-2000"),
    require("./vegana-2200"),
    require("./ayuno-16-8-1800"),
  ],
};
