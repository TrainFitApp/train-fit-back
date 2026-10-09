// Volumen limpio a 2.800 kcal, en cinco comidas: superávit pequeño para ganar
// músculo sin acumular grasa (quien pesa 70-80 kg). Unos 170 g de proteína.

module.exports = {
  name: "Volumen · 2.800 kcal",
  menus: [
    {
      name: "Día de entreno",
      target: { kcal: 2900, protein: 170 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 85], ["yogur_griego", 230], ["frutos_rojos", 80], ["nueces", 20]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 160], ["tomate_triturado", 50], ["aceite_oliva", 15], ["pavo_fiambre", 95]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 100], ["clara", 140], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 15]] },
          ],
        },
        {
          slot: "Almuerzo",
          alternatives: [
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 100], ["pavo_fiambre", 55], ["aceite_oliva", 5]] },
            { label: "Yogur griego con mango y nueces", foods: [["yogur_griego", 190], ["mango", 180], ["nueces", 15]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 140], ["pollo_pechuga", 200], ["verduras_wok", 150], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 150], ["ternera_picada", 140], ["tomate_triturado", 120], ["aceite_oliva", 15]] },
            { label: "Lentejas con arroz, verduras y pollo", foods: [["lentejas", 100], ["arroz_blanco", 60], ["pollo_pechuga", 100], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 450], ["salmon", 160], ["esparragos", 150], ["aceite_oliva", 10]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 180], ["pina", 250], ["almendras", 20]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 170], ["melocoton", 250], ["nueces", 20]] },
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 110], ["pavo_fiambre", 50], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 210], ["patata", 370], ["judias_verdes", 150], ["aceite_oliva", 20]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 210], ["boniato", 370], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 15]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 400], ["huevo", 110], ["clara", 160], ["espinacas", 80], ["aceite_oliva", 10]] },
            { label: "Ensalada de garbanzos con atún, pimiento asado y pan integral", foods: [["atun_natural", 80], ["garbanzos", 260], ["pan_integral", 85], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 10]] },
          ],
        },
      ],
    },
    {
      name: "Día de descanso",
      target: { kcal: 2700, protein: 170 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 60], ["yogur_griego", 260], ["frutos_rojos", 80], ["nueces", 25]] },
            { label: "Tostadas con tomate, aceite de oliva y pavo", foods: [["pan_integral", 150], ["tomate_triturado", 50], ["aceite_oliva", 15], ["pavo_fiambre", 100]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 80], ["clara", 150], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 20]] },
          ],
        },
        {
          slot: "Almuerzo",
          alternatives: [
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 80], ["pavo_fiambre", 65], ["aceite_oliva", 10]] },
            { label: "Yogur griego con mango y nueces", foods: [["yogur_griego", 190], ["mango", 150], ["nueces", 15]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con pollo y verduras", foods: [["arroz_blanco", 120], ["pollo_pechuga", 210], ["verduras_wok", 150], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con ternera y tomate", foods: [["penne_integral", 140], ["ternera_picada", 150], ["tomate_triturado", 120], ["aceite_oliva", 15]] },
            { label: "Lentejas con arroz, verduras y pollo", foods: [["lentejas", 90], ["arroz_blanco", 50], ["pollo_pechuga", 110], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Salmón al horno con patata y espárragos", foods: [["patata", 450], ["salmon", 160], ["esparragos", 150], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 170], ["pina", 200], ["almendras", 25]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 170], ["melocoton", 250], ["nueces", 15]] },
            { label: "Bocadillo integral de pavo con aceite de oliva", foods: [["pan_integral", 90], ["pavo_fiambre", 60], ["aceite_oliva", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Bacalao con patata y judías verdes", foods: [["bacalao", 220], ["patata", 300], ["judias_verdes", 150], ["aceite_oliva", 20]] },
            { label: "Pollo a la plancha con boniato y ensalada", foods: [["pollo_pechuga", 210], ["boniato", 290], ["lechuga", 100], ["zanahoria", 50], ["aceite_oliva", 20]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 320], ["huevo", 110], ["clara", 180], ["espinacas", 80], ["aceite_oliva", 10]] },
            { label: "Ensalada de garbanzos con atún, pimiento asado y pan integral", foods: [["atun_natural", 100], ["garbanzos", 210], ["pan_integral", 70], ["lechuga", 80], ["pimiento_asado", 60], ["aceite_oliva", 15]] },
          ],
        },
      ],
    },
  ],
};
