// La tabla de intercambios estándar, para no empezar en blanco.
//
// El porqué: montar la biblioteca desde cero es el trabajo del primer día y
// es el mismo para todo el mundo — estos seis grupos, con estos perfiles, son
// los de cualquier manual de dietética. Pedirle a cada entrenador que los
// teclee es cobrarle un peaje por usar el método.
//
// Lo que sigue decidiendo él: TODO lo que viene después. Esto se copia a su
// biblioteca como grupos suyos, editables y borrables — no es un catálogo
// compartido ni una referencia que se actualice por detrás. Si su ración de
// proteína son 20 g y no 7, cambia el número y ya está.
//
// Las cantidades de cada alimento son las que cuadran con el perfil del
// grupo, no aproximaciones: 20 g de arroz crudo SON 15 g de hidratos. Se
// pueden verificar con verify-food-exchange-profiles.js en cuanto él vincule
// los productos.

const STARTER_GROUPS = [
  {
    key: "starch",
    name: "Almidones y cereales",
    category: "Carbohidrato",
    anchor: "carbs",
    role: "carb",
    serving: { kcal: 80, protein: 3, carbs: 15, fat: 1 },
    equivalenceNote: "Equivalen en HIDRATOS (15 g por ración). Pesa siempre en crudo.",
    items: [
      { name: "Arroz", quantity: 20, unit: "g", note: "en crudo" },
      { name: "Pasta", quantity: 23, unit: "g", note: "en crudo" },
      { name: "Pan", quantity: 30, unit: "g", note: "" },
      { name: "Patata", quantity: 85, unit: "g", note: "" },
      { name: "Avena en copos", quantity: 25, unit: "g", note: "" },
      { name: "Legumbre cocida", quantity: 70, unit: "g", note: "escurrida" },
    ],
  },
  {
    key: "fruit",
    name: "Frutas",
    category: "Fruta",
    anchor: "carbs",
    role: "fruit",
    serving: { kcal: 60, protein: 0, carbs: 15, fat: 0 },
    equivalenceNote: "Equivalen en HIDRATOS (15 g por ración). Peso de la parte comestible.",
    items: [
      { name: "Manzana", quantity: 110, unit: "g", note: "" },
      { name: "Plátano", quantity: 65, unit: "g", note: "" },
      { name: "Naranja", quantity: 140, unit: "g", note: "" },
      { name: "Fresas", quantity: 200, unit: "g", note: "" },
      { name: "Uvas", quantity: 90, unit: "g", note: "" },
    ],
  },
  {
    key: "vegetable",
    name: "Verduras",
    category: "Verdura",
    anchor: "carbs",
    role: "vegetable",
    serving: { kcal: 25, protein: 2, carbs: 5, fat: 0 },
    equivalenceNote: "Equivalen en HIDRATOS (5 g por ración). Si las pautas libres, márcalo en el grupo.",
    items: [
      { name: "Brócoli", quantity: 100, unit: "g", note: "" },
      { name: "Calabacín", quantity: 150, unit: "g", note: "" },
      { name: "Espinacas", quantity: 150, unit: "g", note: "" },
      { name: "Pimiento", quantity: 100, unit: "g", note: "" },
      { name: "Tomate", quantity: 130, unit: "g", note: "" },
    ],
  },
  {
    key: "dairy",
    name: "Lácteos desnatados",
    category: "Lácteo",
    anchor: "protein",
    role: "dairy",
    serving: { kcal: 90, protein: 8, carbs: 12, fat: 0 },
    equivalenceNote: "Equivalen en PROTEÍNA (8 g) y llevan hidratos: cuentan en los dos.",
    items: [
      { name: "Leche desnatada", quantity: 240, unit: "ml", note: "" },
      { name: "Yogur natural desnatado", quantity: 245, unit: "g", note: "" },
      { name: "Queso fresco batido 0%", quantity: 200, unit: "g", note: "" },
    ],
  },
  {
    key: "protein",
    name: "Carnes magras, pescado y huevo",
    category: "Proteína",
    anchor: "protein",
    role: "protein",
    serving: { kcal: 55, protein: 7, carbs: 0, fat: 2 },
    equivalenceNote: "Equivalen en PROTEÍNA (7 g), no en calorías. La grasa cambia entre ellos.",
    items: [
      { name: "Pechuga de pollo", quantity: 30, unit: "g", note: "en crudo" },
      { name: "Pavo", quantity: 30, unit: "g", note: "en crudo" },
      { name: "Merluza", quantity: 40, unit: "g", note: "" },
      { name: "Atún al natural", quantity: 27, unit: "g", note: "escurrido" },
      { name: "Clara de huevo", quantity: 65, unit: "g", note: "" },
    ],
  },
  {
    key: "fat",
    name: "Grasas",
    category: "Grasa",
    anchor: "fat",
    role: "fat",
    serving: { kcal: 45, protein: 0, carbs: 0, fat: 5 },
    equivalenceNote: "Equivalen en GRASA (5 g por ración).",
    items: [
      { name: "Aceite de oliva virgen extra", quantity: 5, unit: "ml", note: "" },
      { name: "Aguacate", quantity: 35, unit: "g", note: "" },
      { name: "Almendras", quantity: 10, unit: "g", note: "crudas" },
      { name: "Nueces", quantity: 8, unit: "g", note: "" },
      { name: "Mantequilla de cacahuete", quantity: 10, unit: "g", note: "100% cacahuete" },
    ],
  },
];

// Los mismos perfiles, sin alimentos, para ofrecerlos como referencia a quien
// YA tiene grupos con una sola cifra declarada. Ver referenceCandidates() en
// exchange-plan.util.ts: se escalan a su tamaño de ración antes de enseñarlos,
// porque la ración estándar de proteína son 7 g y la suya puede ser 20.
const REFERENCE_PROFILES = STARTER_GROUPS.map(({ key, name, category, anchor, serving }) => ({
  key,
  name,
  category,
  anchor,
  serving,
}));

module.exports = { STARTER_GROUPS, REFERENCE_PROFILES };
