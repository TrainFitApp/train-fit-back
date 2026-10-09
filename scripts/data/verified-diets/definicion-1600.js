// Definición a 1.600 kcal: déficit moderado para quien pesa en torno a 55-65 kg
// y entrena 3-4 días. Proteína alta (unos 140 g, ~2,2 g/kg) para conservar
// músculo; los hidratos se concentran en los días de entreno.

module.exports = {
  name: "Definición · 1.600 kcal",
  menus: [
    {
      name: "Día de entreno",
      target: { kcal: 1700, protein: 140 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 30], ["yogur_griego", 280], ["frutos_rojos", 80], ["nueces", 15]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 100], ["tomate_triturado", 50], ["aceite_oliva", 10], ["pavo_fiambre", 120]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 40], ["clara", 180], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 10]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 80], ["pollo_pechuga", 200], ["verduras_wok", 150], ["aceite_oliva", 15]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 90], ["ternera_picada", 150], ["tomate_triturado", 120], ["aceite_oliva", 5]] },
            { label: "Lentejas estofadas con verduras y pollo", foods: [["lentejas", 90], ["pollo_pechuga", 100], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 290], ["salmon", 130], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 180], ["pina", 120], ["almendras", 15]] },
            { label: "Tortitas de arroz con pavo", foods: [["tortitas_arroz", 40], ["pavo_fiambre", 100]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 160], ["melocoton", 180], ["nueces", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 230], ["patata", 150], ["judias_verdes", 150], ["aceite_oliva", 10]] },
            { label: "Tortilla de claras con espinacas y pan integral", foods: [["clara", 220], ["huevo", 55], ["espinacas", 100], ["pan_integral", 70], ["aceite_oliva", 5]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 220], ["boniato", 150], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 10]] },
            { label: "Ensalada de garbanzos con atún y pimiento asado", foods: [["atun_natural", 140], ["garbanzos", 210], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 10]] },
          ],
        },
      ],
    },
    {
      name: "Día de descanso",
      target: { kcal: 1500, protein: 140 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 30], ["yogur_griego", 300], ["frutos_rojos", 80], ["nueces", 10]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 70], ["tomate_triturado", 50], ["aceite_oliva", 10], ["pavo_fiambre", 120]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 30], ["clara", 190], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 10]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 55], ["pollo_pechuga", 210], ["verduras_wok", 150], ["aceite_oliva", 15]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 60], ["ternera_picada", 170], ["tomate_triturado", 120], ["aceite_oliva", 5]] },
            { label: "Lentejas estofadas con verduras y pollo", foods: [["lentejas", 75], ["pollo_pechuga", 100], ["verduras_mezcla", 120], ["aceite_oliva", 15]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 190], ["salmon", 140], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 180], ["pina", 80], ["almendras", 15]] },
            { label: "Tortitas de arroz con pavo", foods: [["tortitas_arroz", 30], ["pavo_fiambre", 100]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 160], ["melocoton", 100], ["nueces", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 220], ["patata", 150], ["judias_verdes", 150], ["aceite_oliva", 10]] },
            { label: "Tortilla de claras con espinacas y pan integral", foods: [["clara", 250], ["huevo", 55], ["espinacas", 100], ["pan_integral", 40], ["aceite_oliva", 5]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 210], ["boniato", 150], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 5]] },
            { label: "Ensalada de garbanzos con atún y pimiento asado", foods: [["atun_natural", 160], ["garbanzos", 120], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 10]] },
          ],
        },
      ],
    },
  ],
};
