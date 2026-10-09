// Ovolactovegetariana a 2.000 kcal: huevo, lácteos, legumbres, tofu y seitán
// para llegar a unos 130 g de proteína sin carne ni pescado.

module.exports = {
  name: "Vegetariana · 2.000 kcal",
  menus: [
    {
      name: "Día de entreno",
      target: { kcal: 2100, protein: 130 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 60], ["yogur_griego", 220], ["frutos_rojos", 80], ["nueces", 20]] },
            { label: "Tostadas con tomate y revuelto de huevo y claras", foods: [["pan_integral", 100], ["tomate_triturado", 50], ["huevo", 110], ["clara", 100], ["aceite_oliva", 5]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 75], ["clara", 120], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 10]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Ensalada templada de quinoa, garbanzos y huevo", foods: [["quinoa", 100], ["garbanzos", 120], ["huevo", 110], ["clara", 100], ["espinacas", 60], ["aceite_oliva", 5]] },
            { label: "Macarrones integrales con seitán, tomate y parmesano", foods: [["penne_integral", 150], ["seitan", 80], ["tomate_triturado", 120], ["parmesano", 15]] },
            { label: "Lentejas estofadas con verduras y huevo duro", foods: [["lentejas", 130], ["huevo", 55], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Arroz con tofu y verduras al wok", foods: [["arroz_blanco", 95], ["tofu", 290], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 150], ["pina", 200], ["almendras", 20]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 150], ["melocoton", 250], ["nueces", 15]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Tortilla de claras con espinacas y pan integral", foods: [["clara", 140], ["huevo", 55], ["espinacas", 100], ["pan_integral", 120], ["aceite_oliva", 5]] },
            { label: "Tofu salteado con verduras y quinoa", foods: [["tofu", 270], ["quinoa", 40], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 270], ["huevo", 110], ["clara", 160], ["espinacas", 80], ["aceite_oliva", 5]] },
          ],
        },
      ],
    },
    {
      name: "Día de descanso",
      target: { kcal: 1900, protein: 130 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Avena con yogur griego y frutos rojos", foods: [["copos_avena", 35], ["yogur_griego", 240], ["frutos_rojos", 80], ["nueces", 25]] },
            { label: "Tostadas con tomate y revuelto de huevo y claras", foods: [["pan_integral", 85], ["tomate_triturado", 50], ["huevo", 110], ["clara", 100], ["aceite_oliva", 5]] },
            { label: "Tortitas de avena y claras con arándanos", foods: [["copos_avena", 55], ["clara", 140], ["huevo", 55], ["arandanos", 60], ["crema_cacahuete", 15]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Ensalada templada de quinoa, garbanzos y huevo", foods: [["quinoa", 70], ["garbanzos", 120], ["huevo", 110], ["clara", 100], ["espinacas", 60], ["aceite_oliva", 10]] },
            { label: "Macarrones integrales con seitán, tomate y parmesano", foods: [["penne_integral", 140], ["seitan", 80], ["tomate_triturado", 120], ["parmesano", 15]] },
            { label: "Lentejas estofadas con verduras y huevo duro", foods: [["lentejas", 110], ["huevo", 55], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Arroz con tofu y verduras al wok", foods: [["arroz_blanco", 70], ["tofu", 300], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Yogur griego con piña y almendras", foods: [["yogur_griego", 150], ["pina", 140], ["almendras", 20]] },
            { label: "Queso cottage con melocotón y nueces", foods: [["queso_cottage", 150], ["melocoton", 230], ["nueces", 10]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Tortilla de claras con espinacas y pan integral", foods: [["clara", 180], ["huevo", 55], ["espinacas", 100], ["pan_integral", 85], ["aceite_oliva", 10]] },
            { label: "Tofu salteado con verduras y quinoa", foods: [["tofu", 300], ["quinoa", 40], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
            { label: "Tortilla de patata y espinacas con claras", foods: [["patata", 190], ["huevo", 110], ["clara", 180], ["espinacas", 80], ["aceite_oliva", 5]] },
          ],
        },
      ],
    },
  ],
};
