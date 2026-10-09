// Mantenimiento o recomposición a 2.400 kcal, en cinco comidas, para quien
// pesa en torno a 70-80 kg y entrena 4-5 días. Unos 155 g de proteína.

module.exports = {
  name: "Mantenimiento · 2.400 kcal",
  menus: [
    {
      name: "Día de entreno",
      target: { kcal: 2500, protein: 155 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 70], ["yogur_griego", 230], ["frutos_rojos", 80], ["nueces", 15]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 160], ["tomate_triturado", 50], ["aceite_oliva", 10], ["pavo_fiambre", 75]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 85], ["clara", 130], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 10]] },
          ],
        },
        {
          slot: "Almuerzo",
          alternatives: [
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 85], ["pavo_fiambre", 55], ["aceite_oliva", 5]] },
            { label: "Yogur griego con mango y nueces", foods: [["yogur_griego", 170], ["mango", 170], ["nueces", 15]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 120], ["pollo_pechuga", 180], ["verduras_wok", 150], ["aceite_oliva", 15]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 140], ["ternera_picada", 120], ["tomate_triturado", 120], ["aceite_oliva", 10]] },
            { label: "Lentejas con arroz, verduras y pollo", foods: [["lentejas", 90], ["arroz_blanco", 50], ["pollo_pechuga", 100], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 450], ["salmon", 140], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 160], ["pina", 220], ["almendras", 20]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 150], ["melocoton", 250], ["nueces", 15]] },
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 95], ["pavo_fiambre", 50], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 200], ["patata", 300], ["judias_verdes", 150], ["aceite_oliva", 15]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 190], ["boniato", 300], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 15]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 330], ["huevo", 110], ["clara", 140], ["espinacas", 80], ["aceite_oliva", 5]] },
            { label: "Ensalada de garbanzos con atún, pimiento asado y pan integral", foods: [["atun_natural", 80], ["garbanzos", 220], ["pan_integral", 70], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 10]] },
          ],
        },
      ],
    },
    {
      name: "Día de descanso",
      target: { kcal: 2300, protein: 155 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 45], ["yogur_griego", 250], ["frutos_rojos", 80], ["nueces", 20]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 120], ["tomate_triturado", 50], ["aceite_oliva", 15], ["pavo_fiambre", 100]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 60], ["clara", 140], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 15]] },
          ],
        },
        {
          slot: "Almuerzo",
          alternatives: [
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 65], ["pavo_fiambre", 65], ["aceite_oliva", 5]] },
            { label: "Yogur griego con mango y nueces", foods: [["yogur_griego", 170], ["mango", 120], ["nueces", 15]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 90], ["pollo_pechuga", 190], ["verduras_wok", 150], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 110], ["ternera_picada", 150], ["tomate_triturado", 120], ["aceite_oliva", 10]] },
            { label: "Lentejas con arroz, verduras y pollo", foods: [["lentejas", 90], ["arroz_blanco", 50], ["pollo_pechuga", 100], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 360], ["salmon", 140], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 160], ["pina", 160], ["almendras", 20]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 150], ["melocoton", 250], ["nueces", 10]] },
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 75], ["pavo_fiambre", 60], ["aceite_oliva", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 210], ["patata", 220], ["judias_verdes", 150], ["aceite_oliva", 20]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 200], ["boniato", 230], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 15]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 250], ["huevo", 110], ["clara", 160], ["espinacas", 80], ["aceite_oliva", 5]] },
            { label: "Ensalada de garbanzos con atún, pimiento asado y pan integral", foods: [["atun_natural", 100], ["garbanzos", 160], ["pan_integral", 55], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 15]] },
          ],
        },
      ],
    },
  ],
};
