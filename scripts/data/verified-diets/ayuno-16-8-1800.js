// Ayuno intermitente 16/8 a 1.800 kcal: tres comidas dentro de una ventana de
// 8 horas (por ejemplo, de 13:00 a 21:00). Comidas grandes y saciantes con
// unos 130 g de proteína.

module.exports = {
  name: "Ayuno 16/8 · 1.800 kcal",
  menus: [
    {
      name: "Día de entreno",
      target: { kcal: 1900, protein: 130 },
      meals: [
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 110], ["pollo_pechuga", 250], ["verduras_wok", 150], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 130], ["ternera_picada", 190], ["tomate_triturado", 120], ["aceite_oliva", 5]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 420], ["salmon", 180], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 220], ["pina", 170], ["almendras", 20]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 200], ["melocoton", 250], ["nueces", 15]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 250], ["boniato", 400], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 20]] },
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 270], ["patata", 420], ["judias_verdes", 150], ["aceite_oliva", 20]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 420], ["huevo", 110], ["clara", 250], ["espinacas", 80], ["aceite_oliva", 10]] },
          ],
        },
      ],
    },
    {
      name: "Día de descanso",
      target: { kcal: 1700, protein: 130 },
      meals: [
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 85], ["pollo_pechuga", 250], ["verduras_wok", 150], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 100], ["ternera_picada", 200], ["tomate_triturado", 120], ["aceite_oliva", 5]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 270], ["salmon", 200], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 210], ["pina", 95], ["almendras", 20]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 200], ["melocoton", 190], ["nueces", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 250], ["boniato", 300], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 20]] },
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 290], ["patata", 300], ["judias_verdes", 150], ["aceite_oliva", 20]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 300], ["huevo", 110], ["clara", 270], ["espinacas", 80], ["aceite_oliva", 15]] },
          ],
        },
      ],
    },
  ],
};
