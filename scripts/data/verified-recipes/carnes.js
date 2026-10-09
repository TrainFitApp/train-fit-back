// Ternera, cerdo y embutidos. Una ración por receta; gramos en crudo y en
// seco.

module.exports = [
  {
    name: "Espaguetis a la boloñesa",
    tags: ["comida", "pasta"],
    ingredients: [["espagueti", 70], ["ternera_picada", 110], ["tomate_triturado", 150], ["cebolla", 40], ["zanahoria", 30], ["parmesano", 8], ["aceite_oliva", 5]],
    steps: [
      "Sofríe la cebolla y la zanahoria en el aceite 6 minutos.",
      "Añade la carne y dórala; incorpora el tomate, orégano y sal y cuece 15 minutos a fuego suave.",
      "Cuece la pasta al dente, mézclala con la salsa y sirve con el parmesano.",
    ],
  },
  {
    name: "Chili con carne y arroz",
    tags: ["comida", "legumbres"],
    ingredients: [["ternera_picada", 120], ["alubias_rojas", 120], ["tomate_troceado", 150], ["pimientos_cebolla", 80], ["arroz_blanco", 50], ["sazonador_taco", 5]],
    steps: [
      "Dora la carne con los pimientos y la cebolla en una cazuela antiadherente.",
      "Añade el tomate, el sazonador y las alubias escurridas y cuece 20 minutos a fuego suave.",
      "Sirve con el arroz cocido.",
    ],
  },
  {
    name: "Hamburguesa de ternera con boniato al horno",
    tags: ["comida", "cena"],
    ingredients: [["ternera_picada", 130], ["muffin_ingles", 57], ["monterey", 15], ["lechuga", 30], ["ketchup", 10], ["boniato", 180]],
    steps: [
      "Corta el boniato en bastones y hornéalo a 210 °C 25 minutos con sal y pimentón.",
      "Forma la hamburguesa, salpimienta y hazla a la plancha 3-4 minutos por lado; pon el queso encima al final.",
      "Monta en el muffin tostado con la lechuga y el kétchup y sirve con el boniato.",
    ],
  },
  {
    name: "Espaguetis con albóndigas de ternera",
    tags: ["comida", "pasta"],
    ingredients: [["espagueti", 70], ["ternera_picada", 120], ["panko", 15], ["huevo", 25], ["salsa_tomate", 120]],
    steps: [
      "Mezcla la carne con el panko, el huevo batido, ajo, perejil y sal y forma albóndigas pequeñas.",
      "Dóralas en una sartén antiadherente, añade la salsa de tomate y cuece tapado 12 minutos.",
      "Sirve sobre los espaguetis cocidos al dente.",
    ],
  },
  {
    name: "Tacos de ternera",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_maiz", 75], ["ternera_picada", 110], ["sazonador_taco", 6], ["salsa_mexicana", 40], ["lechuga", 30], ["monterey", 15]],
    steps: [
      "Dora la carne en una sartén antiadherente con el sazonador y un chorrito de agua.",
      "Calienta las tortillas.",
      "Rellénalas con la lechuga, la carne, la salsa y el queso rallado.",
    ],
  },
  {
    name: "Fajitas de ternera",
    tags: ["comida", "cena"],
    ingredients: [["ternera_falda", 140], ["pimientos_cebolla", 120], ["tortilla_trigo", 90], ["salsa_mexicana", 30], ["aceite_oliva", 5], ["sazonador_taco", 5]],
    steps: [
      "Corta la falda en tiras finas a contrapelo y mézclala con el sazonador.",
      "Saltéala con el aceite a fuego muy fuerte 2-3 minutos, añade los pimientos y la cebolla y saltea 4 minutos más.",
      "Sirve en las tortillas calientes con la salsa.",
    ],
  },
  {
    name: "Ternera salteada con brócoli y arroz",
    tags: ["comida", "cena"],
    ingredients: [["ternera_falda", 140], ["brocoli", 150], ["arroz_blanco", 60], ["salsa_soja", 15], ["maicena", 4], ["aceite_sesamo", 5]],
    steps: [
      "Cuece el arroz y el brócoli al vapor 4 minutos.",
      "Mezcla la ternera en tiras con la maicena y saltéala con el aceite a fuego fuerte 2 minutos, con jengibre y ajo.",
      "Añade el brócoli y la soja con un poco de agua, saltea un minuto hasta que la salsa espese y sirve con el arroz.",
    ],
  },
  {
    name: "Burrito de ternera y alubias",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_trigo", 45], ["ternera_picada", 100], ["alubias_negras", 80], ["arroz_integral", 40], ["salsa_mexicana", 40], ["monterey", 15], ["sazonador_taco", 5]],
    steps: [
      "Cuece el arroz. Dora la carne con el sazonador y añade las alubias escurridas.",
      "Calienta la tortilla y reparte en el centro el arroz, la carne, la salsa y el queso.",
      "Enróllala cerrando los extremos y dórala un minuto por cada lado.",
    ],
  },
  {
    name: "Bibimbap de ternera",
    tags: ["comida", "cena", "arroz"],
    ingredients: [["arroz_blanco", 70], ["ternera_picada", 110], ["huevo", 50], ["espinacas", 50], ["zanahoria", 40], ["sriracha", 10], ["salsa_soja", 10], ["aceite_sesamo", 4]],
    steps: [
      "Cuece el arroz.",
      "Dora la carne con la soja y ajo; saltea por separado las espinacas y la zanahoria con el aceite de sésamo.",
      "Monta el bol con el arroz, las verduras y la carne, pon un huevo frito a la plancha encima y sirve con la sriracha.",
    ],
  },
  {
    name: "Ternera estofada con patatas",
    tags: ["comida"],
    ingredients: [["ternera_falda", 150], ["patata", 200], ["zanahoria", 60], ["guisantes", 40], ["cebolla", 40], ["tomate_concentrado", 15], ["caldo_pollo", 250], ["aceite_oliva", 7]],
    steps: [
      "Dora la ternera en dados con el aceite y resérvala.",
      "Sofríe la cebolla y la zanahoria, añade el tomate concentrado, laurel y la carne, cubre con el caldo y cuece tapado 40 minutos.",
      "Añade la patata en trozos y los guisantes y cuece 20 minutos más, hasta que la patata esté tierna.",
    ],
  },
  {
    name: "Pita de ternera estilo kebab",
    tags: ["comida", "cena"],
    ingredients: [["pan_pita", 60], ["ternera_falda", 120], ["col", 60], ["yogur_griego", 50], ["cebolla", 20]],
    steps: [
      "Marina la ternera en tiras con comino, pimentón, ajo y orégano y saltéala a fuego muy fuerte 3 minutos.",
      "Mezcla el yogur con ajo, limón, sal y hierbabuena.",
      "Abre la pita caliente y rellena con la col, la cebolla, la carne y la salsa de yogur.",
    ],
  },
  {
    name: "Ñoquis con boloñesa de ternera",
    tags: ["comida", "cena"],
    ingredients: [["gnocchi", 200], ["ternera_picada", 100], ["tomate_triturado", 120], ["parmesano", 8]],
    steps: [
      "Dora la carne y añade el tomate con orégano; cuece 12 minutos.",
      "Cuece los ñoquis hasta que suban a la superficie.",
      "Mézclalos con la salsa y sirve con el parmesano.",
    ],
  },
  {
    name: "Wrap de rosbif y queso crema",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_trigo", 45], ["rosbif", 70], ["queso_crema", 20], ["lechuga", 30], ["pimiento_asado", 30]],
    steps: [
      "Calienta la tortilla y úntala con el queso crema.",
      "Reparte la lechuga, el rosbif y el pimiento en tiras.",
      "Enróllala apretada y córtala por la mitad.",
    ],
  },
  {
    name: "Solomillo de cerdo con boniato y judías verdes",
    tags: ["comida", "cena"],
    ingredients: [["cerdo_solomillo", 160], ["boniato", 200], ["judias_verdes", 120], ["aceite_oliva", 7]],
    steps: [
      "Hornea el boniato en dados con la mitad del aceite a 200 °C 25 minutos.",
      "Dora el solomillo entero con el resto del aceite y termínalo 12 minutos en el horno; déjalo reposar 5 antes de cortarlo.",
      "Cuece las judías al vapor 6 minutos y sirve todo con pimienta negra.",
    ],
  },
  {
    name: "Cerdo agridulce con piña y arroz",
    tags: ["comida", "cena"],
    ingredients: [["cerdo_solomillo", 150], ["pina", 80], ["pimientos_cebolla", 100], ["ketchup", 15], ["salsa_soja", 10], ["maicena", 5], ["arroz_blanco", 60], ["aceite_oliva", 5]],
    steps: [
      "Cuece el arroz. Mezcla el kétchup, la soja, un chorrito de vinagre, la maicena y 50 ml del jugo de la piña.",
      "Saltea el cerdo en dados con el aceite a fuego fuerte 4 minutos y añade los pimientos y la cebolla.",
      "Incorpora la piña y la salsa y cuece un minuto hasta que espese. Sirve con el arroz.",
    ],
  },
  {
    name: "Solomillo de cerdo al pesto con patatas y espárragos",
    tags: ["comida", "cena"],
    ingredients: [["cerdo_solomillo", 150], ["pesto", 12], ["patata", 200], ["esparragos", 100]],
    steps: [
      "Cuece la patata en trozos 15 minutos.",
      "Haz el solomillo en medallones a la plancha 3 minutos por lado y saltea los espárragos.",
      "Sirve con el pesto por encima de la carne.",
    ],
  },
  {
    name: "Tacos de cerdo con piña",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_maiz", 75], ["cerdo_solomillo", 130], ["pina", 50], ["salsa_verde", 30], ["cebolla", 20], ["sazonador_taco", 5]],
    steps: [
      "Corta el cerdo en tiras finas, mézclalo con el sazonador y saltéalo a fuego fuerte 4 minutos.",
      "Dora la piña en dados en la misma sartén.",
      "Sirve en las tortillas calientes con la piña, la cebolla, la salsa verde y cilantro.",
    ],
  },
  {
    name: "Lentejas con chorizo y verduras",
    tags: ["comida", "legumbres"],
    ingredients: [["lentejas", 70], ["chorizo", 25], ["zanahoria", 50], ["cebolla", 40], ["pimiento_verde", 40], ["tomate_triturado", 80], ["patata", 80], ["caldo_verduras", 400], ["aceite_oliva", 5]],
    steps: [
      "Sofríe la cebolla, el pimiento y la zanahoria en el aceite 6 minutos; añade el chorizo y pimentón.",
      "Incorpora el tomate, las lentejas lavadas, la patata en trozos, laurel y el caldo.",
      "Cuece a fuego suave 35-40 minutos, hasta que las lentejas estén tiernas.",
    ],
  },
  {
    name: "Espaguetis carbonara ligera",
    tags: ["comida", "pasta"],
    ingredients: [["espagueti", 80], ["bacon_pavo", 40], ["huevo", 50], ["clara", 30], ["parmesano", 12], ["guisantes", 40]],
    steps: [
      "Cuece la pasta con los guisantes y reserva un vaso del agua de cocción.",
      "Dora el bacon en tiras en una sartén sin aceite. Bate el huevo, la clara, el parmesano y mucha pimienta.",
      "Fuera del fuego, mezcla la pasta con el bacon y el huevo, añadiendo agua de cocción hasta que quede cremosa sin cuajar.",
    ],
  },
  {
    name: "Macarrones con chorizo y pavo",
    tags: ["comida", "pasta"],
    ingredients: [["penne", 80], ["chorizo", 20], ["pavo_picado", 80], ["salsa_tomate", 120], ["mozzarella", 15]],
    steps: [
      "Cuece la pasta al dente.",
      "Dora el chorizo y el pavo en una sartén sin aceite.",
      "Añade la salsa, mezcla con la pasta, cubre con la mozzarella y gratina 5 minutos.",
    ],
  },
  {
    name: "Pizza de jamón y champiñones",
    tags: ["comida", "cena"],
    ingredients: [["base_pizza", 100], ["salsa_tomate", 50], ["jamon_cocido", 50], ["champinones", 60], ["mozzarella", 40]],
    steps: [
      "Precalienta el horno a 220 °C.",
      "Extiende la salsa sobre la base con orégano y reparte el jamón, los champiñones y la mozzarella.",
      "Hornea 10-12 minutos.",
    ],
  },
  {
    name: "Pizza naan de pavo, espinacas y ricotta",
    tags: ["comida", "cena"],
    ingredients: [["naan", 90], ["salsa_tomate", 40], ["pavo_fiambre", 50], ["ricotta", 40], ["espinacas", 30], ["mozzarella", 20]],
    steps: [
      "Precalienta el horno a 220 °C.",
      "Unta el naan con la salsa y reparte las espinacas, el pavo, la ricotta a cucharaditas y la mozzarella.",
      "Hornea 8-10 minutos.",
    ],
  },
  {
    name: "Ensalada de pasta con jamón y queso",
    tags: ["comida", "ensalada", "pasta"],
    ingredients: [["penne", 70], ["jamon_cocido", 60], ["mozzarella", 25], ["maiz", 40], ["guisantes", 30], ["lechuga", 40], ["aceite_oliva", 7]],
    steps: [
      "Cuece la pasta y los guisantes, enfríalos y escúrrelos.",
      "Mezcla con el jamón en dados, la mozzarella y el maíz.",
      "Aliña con el aceite, vinagre y sal y sirve sobre la lechuga.",
    ],
  },
  {
    name: "Arroz tres delicias con jamón y huevo",
    tags: ["comida", "cena", "arroz"],
    ingredients: [["arroz_blanco", 70], ["jamon_cocido", 70], ["huevo", 50], ["guisantes", 40], ["zanahoria", 30], ["maiz", 30], ["salsa_soja", 10], ["aceite_oliva", 5]],
    steps: [
      "Cuece el arroz y déjalo enfriar (mejor del día anterior).",
      "Haz una tortilla fina con el huevo y córtala en tiras. Saltea la zanahoria, los guisantes y el maíz con el aceite.",
      "Añade el arroz, el jamón en dados y la soja y saltea a fuego fuerte 3 minutos; incorpora la tortilla.",
    ],
  },
  {
    name: "Espaguetis con salchichas de pollo y brócoli",
    tags: ["comida", "pasta"],
    ingredients: [["espagueti", 80], ["salchicha_pollo", 80], ["brocoli", 120], ["parmesano", 8], ["aceite_oliva", 5]],
    steps: [
      "Cuece la pasta y añade el brócoli los últimos 4 minutos.",
      "Dora las salchichas en rodajas con el aceite, ajo y guindilla.",
      "Mezcla con la pasta y el brócoli y sirve con el parmesano.",
    ],
  },
  {
    name: "Salchichas de pollo con alubias en salsa de tomate",
    tags: ["comida", "cena", "legumbres"],
    ingredients: [["salchicha_pollo", 100], ["alubias_blancas", 150], ["tomate_triturado", 120], ["pan_integral", 40]],
    steps: [
      "Dora las salchichas en una cazuela antiadherente.",
      "Añade el tomate con pimentón y una pizca de comino y cuece 5 minutos.",
      "Incorpora las alubias escurridas, cuece 8 minutos y sirve con el pan.",
    ],
  },
  {
    name: "Pizza de alcachofas, jamón y aceitunas",
    tags: ["comida", "cena"],
    ingredients: [["base_pizza", 100], ["salsa_tomate", 50], ["jamon_cocido", 50], ["alcachofa", 60], ["aceitunas", 10], ["mozzarella", 35]],
    steps: [
      "Precalienta el horno a 220 °C.",
      "Extiende la salsa con orégano y reparte el jamón, las alcachofas escurridas en cuartos, las aceitunas y la mozzarella.",
      "Hornea 10-12 minutos.",
    ],
  },
];
