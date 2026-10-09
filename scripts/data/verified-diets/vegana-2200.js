// Vegana a 2.200 kcal, en cinco comidas: tofu, seitán, legumbres, edamame y
// proteína vegetal en polvo para llegar a unos 130 g de proteína.

module.exports = {
  name: "Vegana · 2.200 kcal",
  menus: [
    {
      name: "Día de entreno",
      target: { kcal: 2300, protein: 130 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Porridge de avena con bebida de soja, proteína vegetal y frutos rojos", foods: [["copos_avena", 60], ["bebida_soja", 250], ["proteina_vegana", 15], ["frutos_rojos", 80], ["crema_cacahuete", 10]] },
            { label: "Tofu revuelto con espinacas y pan de pita", foods: [["pan_pita", 100], ["tofu", 170], ["espinacas", 60], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Almuerzo",
          alternatives: [
            { label: "Batido de proteína vegetal con mango y crema de almendra", foods: [["bebida_almendra", 250], ["proteina_vegana", 15], ["mango", 160], ["crema_almendra", 10]] },
            { label: "Edamame con mandarina", foods: [["edamame", 160], ["mandarina", 160]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con tofu y verduras al wok", foods: [["arroz_blanco", 90], ["tofu", 250], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
            { label: "Lentejas estofadas con verduras", foods: [["lentejas", 130], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con seitán y tomate", foods: [["penne_integral", 130], ["seitan", 80], ["tomate_triturado", 120], ["aceite_oliva", 20]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Batido de proteína vegetal con frutos rojos y nueces", foods: [["bebida_soja", 250], ["proteina_vegana", 15], ["frutos_rojos", 140], ["nueces", 10]] },
            { label: "Pan de pita con hummus y edamame", foods: [["pan_pita", 40], ["hummus", 80], ["edamame", 80]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Tofu salteado con verduras y quinoa", foods: [["tofu", 200], ["quinoa", 60], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
            { label: "Chili de alubias rojas y seitán con arroz integral", foods: [["alubias_rojas", 160], ["seitan", 80], ["tomate_triturado", 100], ["arroz_integral", 40], ["aceite_oliva", 15]] },
          ],
        },
      ],
    },
    {
      name: "Día de descanso",
      target: { kcal: 2100, protein: 130 },
      meals: [
        {
          slot: "Desayuno",
          alternatives: [
            { label: "Porridge de avena con bebida de soja, proteína vegetal y frutos rojos", foods: [["copos_avena", 40], ["bebida_soja", 250], ["proteina_vegana", 15], ["frutos_rojos", 80], ["crema_cacahuete", 20]] },
            { label: "Tofu revuelto con espinacas y pan de pita", foods: [["pan_pita", 75], ["tofu", 190], ["espinacas", 60], ["aceite_oliva", 5]] },
          ],
        },
        {
          slot: "Almuerzo",
          alternatives: [
            { label: "Batido de proteína vegetal con mango y crema de almendra", foods: [["bebida_almendra", 250], ["proteina_vegana", 20], ["mango", 120], ["crema_almendra", 10]] },
            { label: "Edamame con mandarina", foods: [["edamame", 170], ["mandarina", 110]] },
          ],
        },
        {
          slot: "Comida",
          alternatives: [
            { label: "Arroz con tofu y verduras al wok", foods: [["arroz_blanco", 65], ["tofu", 270], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
            { label: "Lentejas estofadas con verduras", foods: [["lentejas", 120], ["verduras_mezcla", 120], ["aceite_oliva", 20]] },
            { label: "Macarrones integrales con seitán y tomate", foods: [["penne_integral", 100], ["seitan", 95], ["tomate_triturado", 120], ["aceite_oliva", 20]] },
          ],
        },
        {
          slot: "Merienda",
          alternatives: [
            { label: "Batido de proteína vegetal con frutos rojos y nueces", foods: [["bebida_soja", 250], ["proteina_vegana", 15], ["frutos_rojos", 90], ["nueces", 10]] },
            { label: "Pan de pita con hummus y edamame", foods: [["pan_pita", 40], ["hummus", 80], ["edamame", 80]] },
          ],
        },
        {
          slot: "Cena",
          alternatives: [
            { label: "Tofu salteado con verduras y quinoa", foods: [["tofu", 230], ["quinoa", 40], ["verduras_wok", 150], ["salsa_soja", 10], ["aceite_sesamo", 5]] },
            { label: "Chili de alubias rojas y seitán con arroz integral", foods: [["alubias_rojas", 120], ["seitan", 100], ["tomate_triturado", 100], ["arroz_integral", 30], ["aceite_oliva", 15]] },
          ],
        },
      ],
    },
  ],
};
