// Pescado y marisco. Una ración por receta; gramos en crudo y en seco.

module.exports = [
  {
    name: "Salmón al horno con patatas y espárragos",
    tags: ["comida", "cena"],
    ingredients: [["salmon", 150], ["patata", 200], ["esparragos", 120], ["aceite_oliva", 5]],
    steps: [
      "Hornea la patata en rodajas con el aceite y sal a 200 °C 20 minutos.",
      "Añade a la bandeja el salmón salpimentado y los espárragos y hornea 12 minutos más.",
      "Sirve con limón y eneldo.",
    ],
  },
  {
    name: "Salmón teriyaki con arroz y edamame",
    tags: ["comida", "cena"],
    ingredients: [["salmon", 140], ["teriyaki", 25], ["arroz_blanco", 50], ["edamame", 60], ["brocoli", 80]],
    steps: [
      "Cuece el arroz; cuece el edamame y el brócoli al vapor 5 minutos.",
      "Haz el salmón a la plancha por el lado de la piel 4 minutos, dale la vuelta y cocina 2 minutos más.",
      "Añade la teriyaki a la sartén, deja que reduzca y glasea el salmón. Sirve con el arroz y las verduras.",
    ],
  },
  {
    name: "Poke bowl de salmón y mango",
    tags: ["comida", "cena", "arroz"],
    ingredients: [["arroz_blanco", 60], ["salmon", 110], ["edamame", 50], ["mango", 60], ["col", 40], ["salsa_soja", 10], ["aceite_sesamo", 3], ["nori", 2]],
    steps: [
      "Cuece el arroz y alíñalo templado con un poco de vinagre y sal.",
      "Corta en dados el salmón (apto para consumo en crudo: congelado previamente al menos 5 días a -20 °C) y marínalo con la soja y el aceite de sésamo 10 minutos.",
      "Monta el bol con el arroz, el salmón, el edamame, el mango, la col y la nori en tiras.",
    ],
  },
  {
    name: "Salmón al miso con fideos soba",
    tags: ["comida", "cena"],
    ingredients: [["salmon", 130], ["miso", 15], ["soba", 60], ["verduras_wok", 120], ["aceite_sesamo", 3]],
    steps: [
      "Mezcla el miso con una cucharada de agua y unta el salmón; hornéalo a 200 °C 12 minutos.",
      "Cuece los fideos y enjuágalos con agua fría.",
      "Saltea las verduras con el aceite, añade los fideos y sirve con el salmón encima.",
    ],
  },
  {
    name: "Salmón al pesto con quinoa y espinacas",
    tags: ["comida", "cena"],
    ingredients: [["salmon", 130], ["pesto", 10], ["quinoa", 55], ["espinacas", 50], ["tomate_seco", 15]],
    steps: [
      "Cuece la quinoa lavada 12 minutos y escúrrela.",
      "Unta el salmón con el pesto y hornéalo a 200 °C 12 minutos.",
      "Saltea las espinacas con los tomates secos picados, mézclalas con la quinoa y sirve con el salmón.",
    ],
  },
  {
    name: "Bowl de salmón y boniato",
    tags: ["comida", "cena"],
    ingredients: [["salmon", 130], ["boniato", 200], ["kale", 50], ["yogur_griego", 30], ["pipas_calabaza", 8]],
    steps: [
      "Hornea el boniato en dados a 200 °C 25 minutos; añade el salmón a la bandeja los últimos 12.",
      "Masajea el kale con sal y limón para que se ablande.",
      "Monta el bol y termina con el yogur mezclado con limón y eneldo y las pipas de calabaza.",
    ],
  },
  {
    name: "Salmón con lentejas y espinacas",
    tags: ["comida", "legumbres"],
    ingredients: [["salmon", 130], ["lentejas", 50], ["espinacas", 50], ["zanahoria", 40], ["caldo_verduras", 200], ["aceite_oliva", 3]],
    steps: [
      "Cuece las lentejas con la zanahoria, laurel y el caldo 25 minutos, hasta que estén tiernas y sin caldo.",
      "Añade las espinacas y deja que se reduzcan.",
      "Haz el salmón a la plancha con el aceite y sírvelo sobre las lentejas.",
    ],
  },
  {
    name: "Ensalada de salmón ahumado, mandarina y nueces",
    tags: ["comida", "cena", "ensalada"],
    ingredients: [["salmon_ahumado", 70], ["kale", 40], ["lechuga", 50], ["mandarina", 80], ["nueces", 10], ["aceite_oliva", 7], ["balsamico", 8], ["pan_integral", 40]],
    steps: [
      "Mezcla el kale y la lechuga en una fuente.",
      "Añade los gajos de mandarina escurridos, el salmón en tiras y las nueces.",
      "Aliña con el aceite y el balsámico y sirve con el pan tostado.",
    ],
  },
  {
    name: "Penne con salmón ahumado y espinacas",
    tags: ["comida", "pasta"],
    ingredients: [["penne", 80], ["salmon_ahumado", 70], ["queso_crema", 25], ["leche_desnatada", 60], ["espinacas", 50]],
    steps: [
      "Cuece la pasta al dente.",
      "Calienta el queso crema con la leche hasta tener una salsa ligera; añade las espinacas.",
      "Mezcla con la pasta y el salmón en tiras fuera del fuego y sirve con pimienta y eneldo.",
    ],
  },
  {
    name: "Hamburguesa de salmón",
    tags: ["comida", "cena"],
    ingredients: [["salmon_lata", 150], ["panko", 15], ["huevo", 25], ["muffin_ingles", 57], ["lechuga", 30], ["yogur_griego", 30]],
    steps: [
      "Escurre el salmón y mézclalo con el panko, el huevo, ralladura de limón, eneldo y sal.",
      "Forma la hamburguesa y hazla a la plancha 3-4 minutos por lado.",
      "Monta en el muffin tostado con la lechuga y el yogur mezclado con limón.",
    ],
  },
  {
    name: "Ensalada de atún, garbanzos y pimiento asado",
    tags: ["comida", "cena", "ensalada", "legumbres"],
    ingredients: [["atun_natural", 120], ["garbanzos", 120], ["pimiento_asado", 60], ["cebolla", 20], ["aceitunas", 15], ["lechuga", 60], ["aceite_oliva", 7]],
    steps: [
      "Escurre el atún y los garbanzos.",
      "Mézclalos con el pimiento en tiras, la cebolla y las aceitunas.",
      "Sirve sobre la lechuga y aliña con el aceite, vinagre y sal.",
    ],
  },
  {
    name: "Ensalada de pasta con atún y maíz",
    tags: ["comida", "ensalada", "pasta"],
    ingredients: [["penne", 70], ["atun_natural", 100], ["maiz", 50], ["pimiento_asado", 40], ["mayonesa_light", 15], ["lechuga", 40]],
    steps: [
      "Cuece la pasta, enfríala y escúrrela.",
      "Mézclala con el atún, el maíz, el pimiento y la mayonesa.",
      "Sirve fría sobre la lechuga.",
    ],
  },
  {
    name: "Ensaladilla rusa ligera",
    tags: ["comida", "cena", "ensalada"],
    ingredients: [["patata", 200], ["atun_natural", 100], ["huevo", 50], ["guisantes", 40], ["zanahoria", 40], ["mayonesa_light", 15], ["yogur_griego", 40], ["aceitunas", 10]],
    steps: [
      "Cuece la patata en dados, los guisantes, la zanahoria y el huevo; enfría todo.",
      "Mezcla la mayonesa con el yogur, limón y sal.",
      "Une las verduras con el atún, el huevo picado y la salsa y decora con las aceitunas.",
    ],
  },
  {
    name: "Wrap de atún y maíz",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_trigo", 45], ["atun_natural", 100], ["yogur_griego", 30], ["maiz", 30], ["lechuga", 30]],
    steps: [
      "Mezcla el atún escurrido con el yogur, el maíz, limón y pimienta.",
      "Calienta la tortilla y pon la lechuga.",
      "Añade el relleno y enróllala.",
    ],
  },
  {
    name: "Tortilla de atún y espinacas",
    tags: ["cena"],
    ingredients: [["huevo", 100], ["clara", 60], ["atun_natural", 80], ["espinacas", 40], ["pan_integral", 40]],
    steps: [
      "Saltea las espinacas hasta que se reduzcan.",
      "Bate los huevos con las claras y sal y añade el atún escurrido y las espinacas.",
      "Cuaja la tortilla en sartén antiadherente por los dos lados y sirve con el pan.",
    ],
  },
  {
    name: "Sándwich de atún",
    tags: ["comida", "cena"],
    ingredients: [["pan_integral", 80], ["atun_natural", 100], ["mayonesa_light", 10], ["yogur_griego", 20], ["lechuga", 20]],
    steps: [
      "Mezcla el atún con la mayonesa, el yogur y pimienta.",
      "Tuesta el pan.",
      "Rellena con la lechuga y la mezcla de atún.",
    ],
  },
  {
    name: "Bowl de atún, arroz integral y edamame",
    tags: ["comida", "cena", "arroz"],
    ingredients: [["arroz_integral", 60], ["atun_natural", 120], ["edamame", 60], ["zanahoria", 40], ["mango", 50], ["salsa_soja", 10], ["sriracha", 5], ["nori", 2]],
    steps: [
      "Cuece el arroz integral.",
      "Mezcla el atún escurrido con la soja y la sriracha.",
      "Monta el bol con el arroz, el atún, el edamame, la zanahoria, el mango y la nori en tiras.",
    ],
  },
  {
    name: "Espaguetis con atún y tomate",
    tags: ["comida", "pasta"],
    ingredients: [["espagueti", 80], ["atun_natural", 100], ["tomate_triturado", 150], ["aceitunas", 15], ["cebolla", 30], ["aceite_oliva", 5]],
    steps: [
      "Sofríe la cebolla en el aceite 5 minutos, añade el tomate y orégano y cuece 10 minutos.",
      "Incorpora el atún escurrido y las aceitunas en rodajas.",
      "Mezcla con la pasta cocida al dente.",
    ],
  },
  {
    name: "Ensalada de pimientos asados con atún y huevo",
    tags: ["cena", "ensalada"],
    ingredients: [["pimiento_asado", 120], ["atun_aceite", 60], ["huevo", 50], ["cebolla", 20], ["pan_integral", 40], ["aceite_oliva", 5]],
    steps: [
      "Cuece el huevo 10 minutos y pélalo.",
      "Corta el pimiento en tiras y mézclalo con la cebolla, el aceite, vinagre y sal.",
      "Añade el atún escurrido y el huevo en cuartos y sirve con el pan.",
    ],
  },
  {
    name: "Pizza de atún y aceitunas",
    tags: ["comida", "cena"],
    ingredients: [["base_pizza", 100], ["salsa_tomate", 50], ["atun_natural", 70], ["cebolla", 20], ["aceitunas", 10], ["mozzarella", 35]],
    steps: [
      "Precalienta el horno a 220 °C.",
      "Extiende la salsa con orégano y reparte el atún, la cebolla, las aceitunas y la mozzarella.",
      "Hornea 10-12 minutos.",
    ],
  },
  {
    name: "Ensalada nizarda",
    tags: ["comida", "cena", "ensalada"],
    ingredients: [["atun_natural", 100], ["huevo", 50], ["judias_verdes", 100], ["patata", 120], ["aceitunas", 15], ["lechuga", 60], ["aceite_oliva", 8]],
    steps: [
      "Cuece la patata en dados, las judías y el huevo; enfríalos.",
      "Monta la ensalada con la lechuga, la patata, las judías, el atún y las aceitunas.",
      "Añade el huevo en cuartos y aliña con el aceite, vinagre y un poco de mostaza.",
    ],
  },
  {
    name: "Huevos rellenos de atún",
    tags: ["snack", "cena"],
    ingredients: [["huevo", 100], ["atun_natural", 50], ["mayonesa_light", 8], ["yogur_griego", 20]],
    steps: [
      "Cuece los huevos 10 minutos, enfríalos y pártelos por la mitad.",
      "Mezcla las yemas con el atún, la mayonesa y el yogur.",
      "Rellena las claras y espolvorea pimentón.",
    ],
  },
  {
    name: "Bacalao al horno con tomate y patatas",
    tags: ["comida", "cena"],
    ingredients: [["bacalao", 180], ["tomate_troceado", 150], ["cebolla", 40], ["pimiento_verde", 40], ["patata", 180], ["aceite_oliva", 8]],
    steps: [
      "Hornea la patata en rodajas con la mitad del aceite a 200 °C 15 minutos.",
      "Sofríe la cebolla y el pimiento con el resto del aceite, añade el tomate y cuece 8 minutos.",
      "Pon el bacalao sobre las patatas, cúbrelo con la salsa y hornea 12 minutos más.",
    ],
  },
  {
    name: "Bacalao con garbanzos y espinacas",
    tags: ["comida", "legumbres"],
    ingredients: [["bacalao", 160], ["garbanzos", 120], ["espinacas", 80], ["caldo_verduras", 150], ["aceite_oliva", 7]],
    steps: [
      "Dora ajo laminado en el aceite, añade pimentón y el caldo.",
      "Incorpora los garbanzos escurridos y las espinacas y cuece 5 minutos.",
      "Pon el bacalao en trozos encima, tapa y cuece 6-8 minutos a fuego suave.",
    ],
  },
  {
    name: "Bacalao en salsa verde con guisantes",
    tags: ["comida", "cena"],
    ingredients: [["bacalao", 180], ["guisantes", 60], ["caldo_verduras", 150], ["maicena", 5], ["aceite_oliva", 7], ["patata", 150]],
    steps: [
      "Cuece la patata en rodajas 12 minutos.",
      "Dora ajo picado en el aceite, añade la maicena disuelta en el caldo y mucho perejil, y remueve hasta que espese.",
      "Añade el bacalao y los guisantes, cuece 6-8 minutos moviendo la cazuela y sirve con la patata.",
    ],
  },
  {
    name: "Tacos de pescado con salsa de yogur",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_maiz", 75], ["tilapia", 150], ["col", 60], ["yogur_griego", 40], ["salsa_mexicana", 30], ["sazonador_taco", 4]],
    steps: [
      "Sazona la tilapia con el sazonador y hazla a la plancha 3 minutos por lado; desmenúzala.",
      "Mezcla el yogur con lima y sal.",
      "Rellena las tortillas calientes con la col, el pescado, la salsa y el yogur.",
    ],
  },
  {
    name: "Tilapia con costra de parmesano y arroz integral",
    tags: ["comida", "cena"],
    ingredients: [["tilapia", 160], ["panko", 15], ["parmesano", 12], ["arroz_integral", 60], ["judias_verdes", 120], ["aceite_oliva", 5]],
    steps: [
      "Cuece el arroz integral.",
      "Mezcla el panko con el parmesano, perejil y el aceite; cubre la tilapia y hornéala a 210 °C 12 minutos.",
      "Cuece las judías al vapor y sirve todo junto.",
    ],
  },
  {
    name: "Tilapia al curry verde con arroz basmati",
    tags: ["comida", "cena"],
    ingredients: [["tilapia", 160], ["curry_verde", 12], ["leche_coco", 100], ["arroz_basmati", 60], ["espinacas", 50]],
    steps: [
      "Sofríe la pasta de curry 1 minuto y añade la leche de coco.",
      "Incorpora la tilapia en trozos y las espinacas y cuece 6 minutos a fuego suave.",
      "Sirve con el arroz cocido y cilantro.",
    ],
  },
  {
    name: "Tilapia en papillote con verduras",
    tags: ["cena"],
    ingredients: [["tilapia", 170], ["verduras_mezcla", 150], ["aceite_oliva", 7], ["patata", 150]],
    steps: [
      "Corta la patata en láminas finas y ponla en papel de horno con las verduras, sal y la mitad del aceite.",
      "Coloca encima el pescado con limón, hierbas y el resto del aceite y cierra el paquete.",
      "Hornea a 200 °C 20 minutos.",
    ],
  },
  {
    name: "Gambas al ajillo con arroz integral",
    tags: ["comida", "cena"],
    ingredients: [["gambas", 150], ["aceite_oliva", 10], ["arroz_integral", 60], ["espinacas", 50]],
    steps: [
      "Cuece el arroz integral.",
      "Dora ajo laminado y guindilla en el aceite a fuego suave; sube el fuego y saltea las gambas 2 minutos.",
      "Añade las espinacas y perejil, mezcla con el arroz y sirve.",
    ],
  },
  {
    name: "Salteado de gambas con verduras y fideos de arroz",
    tags: ["comida", "cena"],
    ingredients: [["gambas", 150], ["fideos_arroz", 60], ["verduras_wok", 150], ["salsa_soja", 15], ["aceite_sesamo", 5]],
    steps: [
      "Hidrata los fideos en agua caliente y escúrrelos.",
      "Saltea las verduras con el aceite, jengibre y ajo 3 minutos y añade las gambas 2 minutos.",
      "Incorpora los fideos y la soja y saltea un minuto más.",
    ],
  },
  {
    name: "Tacos de gambas con mango",
    tags: ["comida", "cena"],
    ingredients: [["tortilla_maiz", 75], ["gambas", 140], ["mango", 60], ["col", 50], ["yogur_griego", 30], ["sriracha", 5]],
    steps: [
      "Saltea las gambas con pimentón y comino 2 minutos.",
      "Mezcla el yogur con la sriracha y lima.",
      "Rellena las tortillas calientes con la col, las gambas, el mango en dados y la salsa.",
    ],
  },
  {
    name: "Espaguetis con gambas y tomate",
    tags: ["comida", "pasta"],
    ingredients: [["espagueti", 80], ["gambas", 130], ["tomate_troceado", 150], ["aceite_oliva", 8]],
    steps: [
      "Dora ajo y guindilla en el aceite, añade el tomate y cuece 8 minutos.",
      "Incorpora las gambas y cocina 2 minutos.",
      "Mezcla con la pasta al dente y perejil picado.",
    ],
  },
  {
    name: "Arroz con gambas y guisantes",
    tags: ["comida", "arroz"],
    ingredients: [["arroz_blanco", 70], ["gambas", 120], ["guisantes", 40], ["pimientos_cebolla", 60], ["tomate_triturado", 50], ["caldo_verduras", 250], ["aceite_oliva", 7]],
    steps: [
      "Sofríe los pimientos y la cebolla en el aceite, añade el tomate y pimentón y cuece 3 minutos.",
      "Incorpora el arroz, nacáralo un minuto y añade el caldo caliente con unas hebras de azafrán.",
      "Cuece 15 minutos, añade las gambas y los guisantes y cuece 3 minutos más; reposa 5 minutos.",
    ],
  },
  {
    name: "Curry de gambas con leche de coco",
    tags: ["comida", "cena"],
    ingredients: [["gambas", 150], ["leche_coco", 120], ["curry_verde", 12], ["arroz_basmati", 60], ["pimientos_cebolla", 60]],
    steps: [
      "Sofríe los pimientos y la cebolla con la pasta de curry 3 minutos.",
      "Añade la leche de coco, cuece 4 minutos y agrega las gambas 2-3 minutos.",
      "Sirve con el arroz basmati y lima.",
    ],
  },
  {
    name: "Ensalada de gambas, quinoa y mango",
    tags: ["comida", "ensalada"],
    ingredients: [["quinoa", 50], ["gambas", 120], ["mango", 70], ["espinacas", 40], ["edamame", 40], ["aceite_oliva", 7]],
    steps: [
      "Cuece la quinoa lavada 12 minutos, escúrrela y enfríala.",
      "Saltea las gambas 2 minutos con ajo y pimienta.",
      "Mezcla todo con el mango en dados y aliña con el aceite, lima y sal.",
    ],
  },
  {
    name: "Orzo con gambas y espinacas",
    tags: ["comida", "pasta"],
    ingredients: [["orzo", 70], ["gambas", 130], ["espinacas", 60], ["parmesano", 10], ["aceite_oliva", 7]],
    steps: [
      "Cuece el orzo al dente y reserva un poco del agua.",
      "Saltea ajo en el aceite, añade las gambas 2 minutos y las espinacas.",
      "Mezcla con el orzo, ralladura de limón y un chorrito del agua reservada y sirve con el parmesano.",
    ],
  },
];
