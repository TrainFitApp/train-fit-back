// Definición a 2.000 kcal: déficit moderado para quien pesa en torno a 70-85 kg
// y entrena 4-5 días. Unos 160 g de proteína; más hidratos el día de entreno.

module.exports = {
  name: "Definición · 2.000 kcal",
  menus: [
    {
      name: "Día de entreno",
      target: { kcal: 2100, protein: 160 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 50], ["yogur_griego", 300], ["frutos_rojos", 80], ["nueces", 20]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 130], ["tomate_triturado", 50], ["aceite_oliva", 10], ["pavo_fiambre", 120]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 65], ["clara", 200], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 10]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 110], ["pollo_pechuga", 220], ["verduras_wok", 150], ["aceite_oliva", 15]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 130], ["ternera_picada", 170], ["tomate_triturado", 120], ["aceite_oliva", 5]] },
            { label: "Lentejas estofadas con verduras y pollo", foods: [["lentejas", 120], ["pollo_pechuga", 100], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 400], ["salmon", 160], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 200], ["pina", 170], ["almendras", 15]] },
            { label: "Tortitas de arroz con pavo", foods: [["tortitas_arroz", 40], ["pavo_fiambre", 120]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 190], ["melocoton", 250], ["nueces", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 270], ["patata", 200], ["judias_verdes", 150], ["aceite_oliva", 15]] },
            { label: "Tortilla de claras con espinacas y pan integral", foods: [["clara", 240], ["huevo", 55], ["espinacas", 100], ["pan_integral", 100], ["aceite_oliva", 5]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 250], ["boniato", 210], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 10]] },
            { label: "Ensalada de garbanzos con atún y pimiento asado", foods: [["atun_natural", 150], ["garbanzos", 290], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 10]] },
          ],
        },
      ],
    },
    {
      name: "Día de descanso",
      target: { kcal: 1900, protein: 160 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 30], ["yogur_griego", 300], ["frutos_rojos", 80], ["nueces", 20]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 110], ["tomate_triturado", 50], ["aceite_oliva", 10], ["pavo_fiambre", 120]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 45], ["clara", 220], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 15]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 80], ["pollo_pechuga", 240], ["verduras_wok", 150], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 95], ["ternera_picada", 190], ["tomate_triturado", 120], ["aceite_oliva", 5]] },
            { label: "Lentejas estofadas con verduras y pollo", foods: [["lentejas", 110], ["pollo_pechuga", 100], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 280], ["salmon", 170], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 200], ["pina", 100], ["almendras", 20]] },
            { label: "Tortitas de arroz con pavo", foods: [["tortitas_arroz", 40], ["pavo_fiambre", 120]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 190], ["melocoton", 180], ["nueces", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 270], ["patata", 150], ["judias_verdes", 150], ["aceite_oliva", 15]] },
            { label: "Tortilla de claras con espinacas y pan integral", foods: [["clara", 280], ["huevo", 55], ["espinacas", 100], ["pan_integral", 65], ["aceite_oliva", 10]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 250], ["boniato", 150], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 10]] },
            { label: "Ensalada de garbanzos con atún y pimiento asado", foods: [["atun_natural", 160], ["garbanzos", 210], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 10]] },
          ],
        },
      ],
    },
  ],
};
