// Platos sin carne ni pescado: legumbres, huevo, lácteos, tofu y seitán.
// Una ración por receta; gramos en crudo y en seco. Las etiquetas
// «vegetariana» y «vegana» no se escriben aquí: las deduce el script de lo
// que lleva cada receta (pantry.js#kind).

module.exports = [
  {
    name: "Lentejas estofadas con verduras",
    tags: ["comida", "legumbres"],
    ingredients: [["lentejas", 70], ["zanahoria", 60], ["cebolla", 40], ["pimiento_verde", 40], ["tomate_triturado", 80], ["patata", 100], ["caldo_verduras", 400], ["aceite_oliva", 7]],
    steps: [
      "Sofríe la cebolla, el pimiento y la zanahoria en el aceite 6 minutos; añade ajo, pimentón y comino.",
      "Incorpora el tomate, las lentejas lavadas, la patata en trozos, laurel y el caldo.",
      "Cuece a fuego suave 35-40 minutos, hasta que las lentejas estén tiernas.",
    ],
  },
  {
    name: "Dal de lentejas con coco y espinacas",
    tags: ["comida", "cena", "legumbres"],
    ingredients: [["lentejas", 70], ["leche_coco", 100], ["tomate_troceado", 100], ["cebolla", 30], ["espinacas", 50], ["arroz_basmati", 40]],
    steps: [
      "Sofríe la cebolla con curry en polvo, cúrcuma, comino, jengibre y ajo 3 minutos.",
      "Añade las lentejas, el tomate, la leche de coco y 300 ml de agua y cuece 30 minutos hasta que estén deshechas.",
      "Incorpora las espinacas al final y sirve con el arroz cocido.",
    ],
  },
  {
    name: "Ensalada templada de lentejas y queso de cabra",
    tags: ["comida", "cena", "ensalada", "legumbres"],
    ingredients: [["lentejas", 60], ["pimiento_asado", 50], ["cebolla", 20], ["maiz", 40], ["queso_cabra", 20], ["espinacas", 30], ["aceite_oliva", 8], ["balsamico", 8]],
    steps: [
      "Cuece las lentejas en agua con laurel 25 minutos, sin que se deshagan, y escúrrelas.",
      "Mézclalas templadas con el pimiento en tiras, la cebolla, el maíz y las espinacas.",
      "Aliña con el aceite y el balsámico y termina con el queso de cabra.",
    ],
  },
  {
    name: "Hamburguesa de lentejas y avena",
    tags: ["comida", "cena", "legumbres"],
    ingredients: [["lentejas", 60], ["copos_avena", 25], ["huevo", 25], ["cebolla", 20], ["zanahoria", 30], ["muffin_ingles", 57], ["lechuga", 20], ["yogur_griego", 30]],
    steps: [
      "Cuece las lentejas 25 minutos, escúrrelas bien y aplástalas con un tenedor.",
      "Mézclalas con la avena, el huevo, la cebolla, la zanahoria, comino y sal; forma la hamburguesa y deja reposar 15 minutos en frío.",
      "Dórala en sartén antiadherente 4 minutos por lado y monta en el muffin con la lechuga y el yogur.",
    ],
  },
  {
    name: "Garbanzos con espinacas",
    tags: ["comida", "legumbres"],
    ingredients: [["garbanzos", 200], ["espinacas", 100], ["tomate_triturado", 80], ["cebolla", 30], ["aceite_oliva", 8], ["pan_pita", 40]],
    steps: [
      "Dora ajo laminado y la cebolla en el aceite; añade comino y pimentón.",
      "Incorpora el tomate y cuece 5 minutos; añade las espinacas hasta que se reduzcan.",
      "Agrega los garbanzos escurridos con un poco de agua, cuece 8 minutos y sirve con el pan.",
    ],
  },
  {
    name: "Curry de garbanzos y espinacas",
    tags: ["comida", "cena", "legumbres"],
    ingredients: [["garbanzos", 180], ["leche_coco", 100], ["tomate_troceado", 100], ["espinacas", 60], ["arroz_basmati", 50]],
    steps: [
      "Sofríe curry en polvo, jengibre y ajo en una cazuela un minuto.",
      "Añade el tomate, la leche de coco y los garbanzos y cuece 12 minutos.",
      "Incorpora las espinacas y sirve con el arroz basmati.",
    ],
  },
  {
    name: "Ensalada mediterránea de garbanzos y queso de cabra",
    tags: ["comida", "cena", "ensalada", "legumbres"],
    ingredients: [["garbanzos", 150], ["pimiento_asado", 50], ["aceitunas", 15], ["queso_cabra", 20], ["cebolla", 15], ["lechuga", 50], ["aceite_oliva", 8]],
    steps: [
      "Escurre y enjuaga los garbanzos.",
      "Mézclalos con el pimiento en tiras, las aceitunas, la cebolla y la lechuga.",
      "Aliña con el aceite, orégano, limón y sal y termina con el queso de cabra.",
    ],
  },
  {
    name: "Bowl de hummus con huevo y verduras",
    tags: ["comida", "cena"],
    ingredients: [["hummus", 60], ["huevo", 100], ["pan_pita", 60], ["kale", 30], ["pimiento_asado", 40], ["garbanzos", 50]],
    steps: [
      "Cuece los huevos 7 minutos y pélalos.",
      "Tuesta los garbanzos en la sartén con pimentón.",
      "Extiende el hummus en el bol y coloca el kale, el pimiento, los garbanzos y los huevos; sirve con la pita caliente.",
    ],
  },
  {
    name: "Burrito vegetariano de alubias y arroz",
    tags: ["comida", "cena", "legumbres"],
    ingredients: [["tortilla_trigo", 45], ["alubias_negras", 100], ["arroz_integral", 40], ["maiz", 40], ["salsa_mexicana", 40], ["monterey", 20], ["yogur_griego", 30]],
    steps: [
      "Cuece el arroz. Calienta las alubias con el maíz, comino y la salsa.",
      "Calienta la tortilla y reparte en el centro el arroz, las alubias, el queso y el yogur.",
      "Enróllala cerrando los extremos y dórala un minuto por cada lado.",
    ],
  },
  {
    name: "Chili vegano de alubias",
    tags: ["comida", "cena", "legumbres"],
    ingredients: [["alubias_rojas", 150], ["alubias_negras", 80], ["tomate_troceado", 150], ["pimientos_cebolla", 100], ["maiz", 50], ["sazonador_taco", 6], ["aceite_oliva", 5], ["arroz_integral", 40]],
    steps: [
      "Sofríe los pimientos y la cebolla en el aceite 6 minutos.",
      "Añade el sazonador, el tomate, las alubias escurridas y el maíz y cuece 20 minutos.",
      "Sirve con el arroz integral cocido.",
    ],
  },
  {
    name: "Tacos veganos de alubias negras y maíz",
    tags: ["comida", "cena", "legumbres"],
    ingredients: [["tortilla_maiz", 75], ["alubias_negras", 120], ["maiz", 50], ["col", 50], ["salsa_verde", 30]],
    steps: [
      "Saltea las alubias escurridas con el maíz, comino y pimentón 4 minutos, aplastando algunas.",
      "Calienta las tortillas.",
      "Rellena con la col, las alubias y la salsa verde, y añade cilantro y lima.",
    ],
  },
  {
    name: "Alubias blancas con verduras",
    tags: ["comida", "legumbres"],
    ingredients: [["alubias_blancas", 200], ["verduras_mezcla", 100], ["tomate_triturado", 80], ["caldo_verduras", 200], ["aceite_oliva", 7]],
    steps: [
      "Sofríe ajo en el aceite y añade el tomate y pimentón.",
      "Incorpora las verduras y el caldo y cuece 8 minutos.",
      "Añade las alubias escurridas y cuece 5 minutos más.",
    ],
  },
  {
    name: "Boniato relleno de alubias negras y queso",
    tags: ["comida", "cena"],
    ingredients: [["boniato", 250], ["alubias_negras", 100], ["salsa_mexicana", 30], ["monterey", 20], ["yogur_griego", 30]],
    steps: [
      "Pincha el boniato y ásalo a 200 °C 45 minutos (o 8-10 minutos en el microondas).",
      "Ábrelo y rellénalo con las alubias calientes mezcladas con la salsa.",
      "Cubre con el queso, gratina 3 minutos y sirve con el yogur.",
    ],
  },
  {
    name: "Tofu salteado con brócoli y arroz integral",
    tags: ["comida", "cena"],
    ingredients: [["tofu", 180], ["brocoli", 150], ["arroz_integral", 60], ["salsa_soja", 15], ["maicena", 5], ["aceite_sesamo", 5]],
    steps: [
      "Prensa el tofu 10 minutos, córtalo en dados y rebózalo en la maicena.",
      "Dóralo con el aceite a fuego fuerte hasta que esté crujiente; añade el brócoli y un poco de agua y tapa 3 minutos.",
      "Añade la soja y sirve con el arroz integral cocido.",
    ],
  },
  {
    name: "Tofu teriyaki con fideos soba",
    tags: ["comida", "cena"],
    ingredients: [["tofu", 160], ["soba", 60], ["teriyaki", 25], ["verduras_wok", 120]],
    steps: [
      "Dora el tofu en dados en una sartén antiadherente.",
      "Añade las verduras y saltea 4 minutos; incorpora la teriyaki.",
      "Mezcla con los fideos cocidos y sirve con sésamo.",
    ],
  },
  {
    name: "Curry verde de tofu con coco",
    tags: ["comida", "cena"],
    ingredients: [["tofu", 160], ["curry_verde", 12], ["leche_coco", 120], ["verduras_wok", 120], ["arroz_basmati", 50]],
    steps: [
      "Sofríe la pasta de curry un minuto y añade la leche de coco.",
      "Incorpora el tofu en dados y las verduras y cuece 8 minutos.",
      "Sirve con el arroz y albahaca o cilantro.",
    ],
  },
  {
    name: "Poke vegano de tofu y edamame",
    tags: ["comida", "cena", "arroz"],
    ingredients: [["arroz_blanco", 60], ["tofu", 120], ["edamame", 60], ["mango", 60], ["col", 40], ["salsa_soja", 10], ["aceite_sesamo", 3], ["nori", 2]],
    steps: [
      "Cuece el arroz y alíñalo templado con vinagre y sal.",
      "Marina el tofu en dados con la soja y el aceite de sésamo 10 minutos (puedes dorarlo si lo prefieres caliente).",
      "Monta el bol con el arroz, el tofu, el edamame, el mango, la col y la nori.",
    ],
  },
  {
    name: "Pad thai de tofu",
    tags: ["comida", "cena"],
    ingredients: [["fideos_arroz", 70], ["tofu", 140], ["col", 60], ["cacahuetes", 12], ["salsa_soja", 15], ["sriracha", 5], ["aceite_oliva", 5]],
    steps: [
      "Hidrata los fideos en agua caliente y escúrrelos.",
      "Dora el tofu en dados con el aceite.",
      "Añade la col, los fideos, la soja, la sriracha y lima; saltea 2 minutos y sirve con los cacahuetes picados.",
    ],
  },
  {
    name: "Seitán salteado con pimientos y arroz",
    tags: ["comida", "cena"],
    ingredients: [["seitan", 140], ["pimientos_cebolla", 120], ["arroz_blanco", 60], ["salsa_soja", 10], ["aceite_oliva", 7]],
    steps: [
      "Cuece el arroz.",
      "Saltea el seitán en tiras con el aceite hasta que se dore.",
      "Añade los pimientos y la cebolla, saltea 5 minutos, riega con la soja y sirve con el arroz.",
    ],
  },
  {
    name: "Fajitas de seitán",
    tags: ["comida", "cena"],
    ingredients: [["seitan", 130], ["pimientos_cebolla", 120], ["tortilla_trigo", 90], ["salsa_mexicana", 30], ["aceite_oliva", 5], ["sazonador_taco", 5]],
    steps: [
      "Corta el seitán en tiras y mézclalo con el sazonador.",
      "Saltéalo con el aceite y los pimientos 6 minutos.",
      "Sirve en las tortillas calientes con la salsa.",
    ],
  },
  {
    name: "Seitán a la barbacoa con boniato",
    tags: ["comida", "cena"],
    ingredients: [["seitan", 140], ["barbacoa", 25], ["boniato", 200], ["col", 60]],
    steps: [
      "Hornea el boniato en gajos a 200 °C 25 minutos.",
      "Dora el seitán en filetes y glaséalo con la salsa barbacoa.",
      "Sirve con el boniato y la col aliñada con vinagre.",
    ],
  },
  {
    name: "Espaguetis con tomate, espinacas y ricotta",
    tags: ["comida", "pasta"],
    ingredients: [["espagueti", 80], ["salsa_tomate", 120], ["espinacas", 60], ["ricotta", 60], ["parmesano", 8]],
    steps: [
      "Cuece la pasta al dente.",
      "Calienta la salsa y añade las espinacas hasta que se reduzcan.",
      "Mezcla con la pasta, reparte la ricotta por encima y termina con el parmesano.",
    ],
  },
  {
    name: "Penne integral con pesto, brócoli y guisantes",
    tags: ["comida", "pasta"],
    ingredients: [["penne_integral", 80], ["pesto", 15], ["brocoli", 100], ["guisantes", 50], ["parmesano", 8]],
    steps: [
      "Cuece la pasta y añade el brócoli y los guisantes los últimos 4 minutos.",
      "Escurre reservando un poco del agua.",
      "Mezcla con el pesto y un chorrito del agua y sirve con el parmesano.",
    ],
  },
  {
    name: "Lasaña de verduras y ricotta",
    tags: ["comida", "pasta"],
    ingredients: [["lasana", 60], ["ricotta", 80], ["espinacas", 80], ["champinones", 80], ["tomate_triturado", 150], ["mozzarella", 30]],
    steps: [
      "Saltea los champiñones y las espinacas y mézclalos con la ricotta, nuez moscada y sal.",
      "Calienta el tomate con orégano.",
      "Monta capas de pasta, tomate y relleno, termina con la mozzarella y hornea a 190 °C 25 minutos.",
    ],
  },
  {
    name: "Pizza margarita con espinacas",
    tags: ["comida", "cena"],
    ingredients: [["base_pizza", 100], ["salsa_tomate", 50], ["mozzarella", 50], ["espinacas", 30]],
    steps: [
      "Precalienta el horno a 220 °C.",
      "Extiende la salsa con orégano, reparte las espinacas y la mozzarella.",
      "Hornea 10-12 minutos y añade albahaca fresca al sacarla.",
    ],
  },
  {
    name: "Pizza de verduras",
    tags: ["comida", "cena"],
    ingredients: [["base_pizza", 100], ["salsa_tomate", 50], ["pimientos_cebolla", 60], ["champinones", 50], ["aceitunas", 10], ["mozzarella", 40]],
    steps: [
      "Precalienta el horno a 220 °C.",
      "Extiende la salsa y reparte las verduras, las aceitunas y la mozzarella.",
      "Hornea 10-12 minutos.",
    ],
  },
  {
    name: "Quesadilla de champiñones y espinacas",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_trigo", 90], ["champinones", 80], ["espinacas", 40], ["monterey", 35], ["salsa_mexicana", 30]],
    steps: [
      "Saltea los champiñones con ajo y añade las espinacas hasta que se reduzcan.",
      "Reparte el relleno y el queso sobre una tortilla y tapa con la otra.",
      "Dórala 2-3 minutos por lado y sirve con la salsa.",
    ],
  },
  {
    name: "Ñoquis a la sorrentina",
    tags: ["comida", "cena"],
    ingredients: [["gnocchi", 220], ["salsa_tomate", 120], ["mozzarella", 40]],
    steps: [
      "Cuece los ñoquis hasta que suban a la superficie.",
      "Mézclalos con la salsa caliente y albahaca en una fuente apta para horno.",
      "Cubre con la mozzarella y gratina 5 minutos.",
    ],
  },
  {
    name: "Tortilla de patata ligera",
    tags: ["comida", "cena"],
    ingredients: [["patata", 200], ["huevo", 100], ["clara", 100], ["cebolla", 40], ["aceite_oliva", 8]],
    steps: [
      "Corta la patata en láminas finas y cuécela al microondas tapada 8 minutos con la cebolla y sal (o confítala a fuego suave con el aceite).",
      "Bate los huevos y las claras y mezcla con la patata.",
      "Cuaja la tortilla en sartén antiadherente con el aceite, 3-4 minutos por lado.",
    ],
  },
  {
    name: "Frittata de verduras y queso de cabra",
    tags: ["cena"],
    ingredients: [["huevo", 100], ["clara", 100], ["verduras_mezcla", 100], ["espinacas", 30], ["queso_cabra", 15], ["aceite_oliva", 4]],
    steps: [
      "Saltea las verduras con el aceite 5 minutos y añade las espinacas.",
      "Vierte los huevos y las claras batidos y reparte el queso.",
      "Cuaja a fuego suave 5 minutos y termina 5 minutos en el horno a 180 °C.",
    ],
  },
  {
    name: "Revuelto de champiñones y espárragos",
    tags: ["cena"],
    ingredients: [["huevo", 100], ["clara", 60], ["champinones", 80], ["esparragos", 100], ["aceite_oliva", 5], ["pan_integral", 40]],
    steps: [
      "Saltea los espárragos en trozos con el aceite 4 minutos y añade los champiñones.",
      "Incorpora los huevos y las claras batidos con sal.",
      "Remueve a fuego suave hasta que cuaje y sirve con el pan.",
    ],
  },
  {
    name: "Bowl de quinoa, tofu y kale",
    tags: ["comida"],
    ingredients: [["quinoa", 60], ["tofu", 120], ["kale", 40], ["pimiento_asado", 50], ["garbanzos", 50], ["aceite_oliva", 7], ["balsamico", 8]],
    steps: [
      "Cuece la quinoa lavada 12 minutos y escúrrela.",
      "Dora el tofu en dados con pimentón.",
      "Monta el bol con el kale, la quinoa, el tofu, los garbanzos y el pimiento y aliña con el aceite y el balsámico.",
    ],
  },
  {
    name: "Ensalada de quinoa, edamame y mango",
    tags: ["comida", "ensalada"],
    ingredients: [["quinoa", 60], ["edamame", 80], ["mango", 70], ["col", 40], ["cacahuetes", 10], ["salsa_soja", 10], ["aceite_sesamo", 4]],
    steps: [
      "Cuece la quinoa, escúrrela y enfríala.",
      "Mézclala con el edamame, el mango en dados y la col.",
      "Aliña con la soja, el aceite de sésamo y lima y termina con los cacahuetes picados.",
    ],
  },
  {
    name: "Buddha bowl de boniato y garbanzos",
    tags: ["comida", "cena"],
    ingredients: [["boniato", 200], ["garbanzos", 120], ["kale", 40], ["hummus", 30], ["pipas_calabaza", 10]],
    steps: [
      "Hornea el boniato en dados y los garbanzos escurridos con pimentón a 200 °C 25 minutos.",
      "Masajea el kale con limón y sal.",
      "Monta el bol y termina con el hummus diluido con agua y limón y las pipas.",
    ],
  },
  {
    name: "Crema de calabaza con garbanzos crujientes",
    tags: ["cena", "sopa"],
    ingredients: [["calabaza", 250], ["leche_coco", 60], ["caldo_verduras", 200], ["garbanzos", 80], ["pipas_calabaza", 8]],
    steps: [
      "Calienta el puré de calabaza con el caldo, la leche de coco, jengibre y nuez moscada 10 minutos y tritura.",
      "Tuesta los garbanzos escurridos en la sartén con pimentón hasta que estén crujientes.",
      "Sirve la crema con los garbanzos y las pipas por encima.",
    ],
  },
  {
    name: "Arroz de coliflor salteado con huevo y edamame",
    tags: ["cena"],
    ingredients: [["arroz_coliflor", 250], ["huevo", 100], ["guisantes", 40], ["zanahoria", 40], ["edamame", 40], ["salsa_soja", 10], ["aceite_sesamo", 5]],
    steps: [
      "Saltea la zanahoria, los guisantes y el edamame con el aceite 3 minutos.",
      "Añade el arroz de coliflor y saltea 4 minutos a fuego fuerte.",
      "Aparta a un lado, revuelve los huevos, mezcla todo con la soja y sirve.",
    ],
  },
  {
    name: "Sopa minestrone",
    tags: ["comida", "cena", "sopa"],
    ingredients: [["verduras_mezcla", 120], ["alubias_blancas", 100], ["tomate_troceado", 120], ["orzo", 30], ["caldo_verduras", 350], ["parmesano", 8], ["aceite_oliva", 5]],
    steps: [
      "Sofríe ajo en el aceite y añade el tomate y las verduras.",
      "Incorpora el caldo y cuece 10 minutos; añade el orzo y las alubias y cuece 8 minutos más.",
      "Sirve con el parmesano y albahaca.",
    ],
  },
  {
    name: "Wrap de hummus y verduras",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_trigo", 45], ["hummus", 50], ["espinacas", 30], ["pimiento_asado", 50], ["zanahoria", 30], ["garbanzos", 50]],
    steps: [
      "Calienta la tortilla y úntala con el hummus.",
      "Reparte las espinacas, el pimiento, la zanahoria y los garbanzos ligeramente aplastados.",
      "Enróllala bien apretada y córtala por la mitad.",
    ],
  },
  {
    name: "Coliflor asada con garbanzos y salsa de yogur",
    tags: ["comida", "cena"],
    ingredients: [["coliflor", 250], ["garbanzos", 100], ["yogur_griego", 60], ["aceite_oliva", 8], ["pan_pita", 40]],
    steps: [
      "Mezcla la coliflor y los garbanzos con el aceite, comino, cúrcuma y sal y ásalos a 210 °C 25 minutos.",
      "Mezcla el yogur con ajo, limón y hierbabuena.",
      "Sirve con la salsa y el pan de pita.",
    ],
  },
];
