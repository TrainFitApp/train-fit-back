// Desayunos. Cada receta es UNA ración; cantidades en gramos (en crudo y en
// seco: arroz, pasta, avena y legumbres secas). Claves de `ingredients` en
// pantry.js. Lo que no aporta energía apreciable (sal, especias, hierbas,
// limón, vinagre, levadura) va en los pasos y no como ingrediente.

module.exports = [
  {
    name: "Porridge de avena con arándanos y nueces",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["leche_desnatada", 250], ["arandanos", 80], ["nueces", 10]],
    steps: [
      "Pon la avena y la leche en un cazo con una pizca de sal y canela.",
      "Cuece a fuego medio-bajo 5 minutos, removiendo, hasta que espese.",
      "Sirve en un bol y cubre con los arándanos y las nueces troceadas.",
    ],
  },
  {
    name: "Porridge proteico de fresas y chocolate negro",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["leche_desnatada", 200], ["proteina_vegana", 25], ["fresas", 80], ["chocolate_negro", 10]],
    steps: [
      "Cuece la avena con la leche 4-5 minutos a fuego medio, removiendo.",
      "Fuera del fuego, añade la proteína en polvo y remueve hasta que no queden grumos (añade un chorrito de agua si queda muy espeso).",
      "Sirve con las fresas troceadas y el chocolate rallado por encima.",
    ],
  },
  {
    name: "Porridge de calabaza con nueces y canela",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["leche_desnatada", 200], ["calabaza", 80], ["nueces", 10], ["sirope_arce", 10]],
    steps: [
      "Calienta la leche con la avena, el puré de calabaza, canela y una pizca de jengibre y nuez moscada.",
      "Cuece 5 minutos a fuego suave hasta que tenga textura cremosa.",
      "Sirve con las nueces troceadas y un hilo de sirope de arce.",
    ],
  },
  {
    name: "Porridge vegano de crema de cacahuete y frutos rojos",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["bebida_soja", 250], ["crema_cacahuete", 15], ["frutos_rojos", 80]],
    steps: [
      "Cuece la avena con la bebida de soja 5 minutos a fuego medio, removiendo.",
      "Pásala a un bol y añade la crema de cacahuete en el centro.",
      "Termina con los frutos rojos descongelados o calentados un minuto en el microondas.",
    ],
  },
  {
    name: "Overnight oats de mango, coco y chía",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["yogur_griego", 150], ["bebida_almendra", 100], ["mango", 80], ["chia", 8], ["coco", 8]],
    steps: [
      "Mezcla en un tarro la avena, el yogur, la bebida de almendra y la chía.",
      "Tapa y deja en la nevera toda la noche (mínimo 4 horas).",
      "Por la mañana, añade el mango en dados y el coco por encima.",
    ],
  },
  {
    name: "Overnight oats de crema de cacahuete y frambuesas",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["leche_desnatada", 150], ["yogur_griego", 100], ["crema_cacahuete", 15], ["frambuesas", 60]],
    steps: [
      "Mezcla la avena, la leche, el yogur y la crema de cacahuete en un tarro.",
      "Añade la mitad de las frambuesas aplastadas con un tenedor y remueve.",
      "Deja reposar en la nevera toda la noche y sirve con el resto de frambuesas.",
    ],
  },
  {
    name: "Quinoa con leche, cerezas y almendras",
    tags: ["desayuno"],
    ingredients: [["quinoa", 50], ["leche_desnatada", 250], ["cerezas", 80], ["almendras", 10]],
    steps: [
      "Lava bien la quinoa bajo el grifo.",
      "Cuécela en la leche con una rama de canela a fuego suave 15-18 minutos, hasta que esté tierna.",
      "Sirve templada con las cerezas y la almendra laminada tostada.",
    ],
  },
  {
    name: "Tortitas de avena y claras con arándanos",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["clara", 150], ["arandanos", 60], ["yogur_griego", 100]],
    steps: [
      "Tritura la avena con las claras, una pizca de levadura química y canela.",
      "Cuaja la masa en una sartén antiadherente a fuego medio, en tortitas pequeñas, 1-2 minutos por lado.",
      "Sirve con el yogur y los arándanos por encima.",
    ],
  },
  {
    name: "Tortitas de calabaza proteicas",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 40], ["huevo", 50], ["clara", 100], ["calabaza", 80], ["sirope_arce", 10]],
    steps: [
      "Bate el huevo, las claras y el puré de calabaza con canela y una pizca de levadura química.",
      "Añade la avena triturada y mezcla hasta tener una masa espesa.",
      "Haz las tortitas en sartén antiadherente a fuego medio y sirve con el sirope.",
    ],
  },
  {
    name: "Tortitas de ricotta con frutos rojos",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 40], ["ricotta", 80], ["huevo", 50], ["clara", 60], ["frutos_rojos", 80], ["miel", 8]],
    steps: [
      "Tritura la avena hasta dejarla como harina.",
      "Mezcla la ricotta, el huevo y las claras; incorpora la avena y una pizca de levadura química.",
      "Cuaja las tortitas en sartén antiadherente y sirve con los frutos rojos y la miel.",
    ],
  },
  {
    name: "Gofres proteicos de avena y cottage",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["queso_cottage", 100], ["huevo", 50], ["fresas", 80]],
    steps: [
      "Tritura la avena, el queso cottage y el huevo con una pizca de levadura química y vainilla.",
      "Precalienta la gofrera y cocina la masa hasta que esté dorada.",
      "Sirve con las fresas troceadas.",
    ],
  },
  {
    name: "Crepes de avena con ricotta y fresas",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 40], ["clara", 120], ["leche_desnatada", 50], ["ricotta", 60], ["fresas", 80]],
    steps: [
      "Tritura la avena con las claras y la leche hasta tener una masa líquida.",
      "Vierte un cazo de masa en una sartén antiadherente caliente, extiéndela y dale la vuelta al minuto.",
      "Rellena las crepes con la ricotta y las fresas laminadas.",
    ],
  },
  {
    name: "Tostadas francesas proteicas con fresas",
    tags: ["desayuno"],
    ingredients: [["pan_integral", 80], ["huevo", 50], ["clara", 100], ["leche_desnatada", 50], ["fresas", 80], ["sirope_arce", 10]],
    steps: [
      "Bate el huevo, las claras y la leche con canela y vainilla.",
      "Empapa las rebanadas de pan por ambos lados.",
      "Dóralas en sartén antiadherente 2 minutos por lado y sirve con las fresas y el sirope.",
    ],
  },
  {
    name: "Tostadas integrales con huevos revueltos y espinacas",
    tags: ["desayuno"],
    ingredients: [["pan_integral", 60], ["huevo", 100], ["clara", 60], ["espinacas", 40], ["aceite_oliva", 3]],
    steps: [
      "Saltea las espinacas con el aceite un minuto, hasta que se reduzcan.",
      "Añade los huevos y las claras batidos con sal y pimienta y remueve a fuego suave hasta que cuajen.",
      "Sirve el revuelto sobre el pan tostado.",
    ],
  },
  {
    name: "Tostada de hummus con huevo y pimiento asado",
    tags: ["desayuno"],
    ingredients: [["pan_integral", 60], ["hummus", 40], ["huevo", 50], ["pimiento_asado", 30]],
    steps: [
      "Cuece el huevo 7 minutos en agua hirviendo, enfríalo y pélalo.",
      "Tuesta el pan y úntalo con el hummus.",
      "Coloca encima el pimiento asado en tiras y el huevo en rodajas, con pimentón y sal.",
    ],
  },
  {
    name: "Tostada de salmón ahumado y queso crema",
    tags: ["desayuno"],
    ingredients: [["pan_integral", 60], ["queso_crema", 25], ["salmon_ahumado", 50]],
    steps: [
      "Tuesta el pan.",
      "Úntalo con el queso crema y coloca el salmón ahumado encima.",
      "Termina con eneldo, pimienta negra y unas gotas de limón.",
    ],
  },
  {
    name: "Bagel de salmón ahumado y espinacas",
    tags: ["desayuno"],
    ingredients: [["bagel", 95], ["queso_crema", 30], ["salmon_ahumado", 60], ["espinacas", 15]],
    steps: [
      "Abre el bagel y tuéstalo ligeramente.",
      "Unta las dos mitades con el queso crema.",
      "Rellena con las espinacas y el salmón y añade eneldo y pimienta.",
    ],
  },
  {
    name: "Tostada de crema de cacahuete, frambuesas y chía",
    tags: ["desayuno", "snack"],
    ingredients: [["pan_integral", 60], ["crema_cacahuete", 15], ["frambuesas", 60], ["chia", 5]],
    steps: [
      "Tuesta el pan.",
      "Úntalo con la crema de cacahuete.",
      "Aplasta ligeramente las frambuesas por encima y espolvorea la chía.",
    ],
  },
  {
    name: "Tostada de ricotta con cerezas y miel",
    tags: ["desayuno", "snack"],
    ingredients: [["pan_integral", 60], ["ricotta", 60], ["cerezas", 60], ["miel", 5]],
    steps: [
      "Tuesta el pan.",
      "Extiende la ricotta por encima.",
      "Añade las cerezas partidas por la mitad y un hilo de miel.",
    ],
  },
  {
    name: "Muffin inglés de huevo, pavo y queso",
    tags: ["desayuno"],
    ingredients: [["muffin_ingles", 57], ["huevo", 50], ["pavo_fiambre", 30], ["monterey", 15]],
    steps: [
      "Abre y tuesta el muffin.",
      "Cuaja el huevo en un aro o en la sartén y salpimienta.",
      "Monta el muffin con el pavo, el huevo y el queso, y caliéntalo un minuto para que se funda.",
    ],
  },
  {
    name: "Burrito de desayuno con alubias y huevo",
    tags: ["desayuno"],
    ingredients: [["tortilla_trigo", 45], ["huevo", 50], ["clara", 100], ["alubias_negras", 40], ["salsa_mexicana", 30], ["monterey", 15]],
    steps: [
      "Haz un revuelto con el huevo y las claras.",
      "Calienta las alubias escurridas y la tortilla.",
      "Rellena la tortilla con el revuelto, las alubias, la salsa y el queso, y enróllala.",
    ],
  },
  {
    name: "Wrap de desayuno con salchicha de pollo",
    tags: ["desayuno"],
    ingredients: [["tortilla_trigo", 45], ["huevo", 50], ["clara", 60], ["salchicha_pollo", 50], ["pimientos_cebolla", 40]],
    steps: [
      "Corta la salchicha en rodajas y dórala con los pimientos y la cebolla en sartén antiadherente.",
      "Añade el huevo y las claras batidos y remueve hasta que cuajen.",
      "Rellena la tortilla caliente y enróllala.",
    ],
  },
  {
    name: "Huevos rancheros",
    tags: ["desayuno", "comida"],
    ingredients: [["tortilla_maiz", 50], ["huevo", 100], ["alubias_negras", 60], ["salsa_mexicana", 50], ["monterey", 15]],
    steps: [
      "Calienta las tortillas en la sartén y resérvalas.",
      "Calienta las alubias con la salsa mexicana.",
      "Cuaja los huevos a la plancha y sírvelos sobre las tortillas con las alubias y el queso.",
    ],
  },
  {
    name: "Revuelto de claras con champiñones y pavo",
    tags: ["desayuno", "cena"],
    ingredients: [["clara", 200], ["huevo", 50], ["champinones", 80], ["pavo_fiambre", 40], ["pan_integral", 40], ["aceite_oliva", 3]],
    steps: [
      "Saltea los champiñones con el aceite hasta que suelten el agua.",
      "Añade el pavo en tiras y luego las claras y el huevo batidos.",
      "Remueve a fuego suave hasta que cuaje y sirve con el pan tostado.",
    ],
  },
  {
    name: "Tortilla francesa de espinacas y queso de cabra",
    tags: ["desayuno", "cena"],
    ingredients: [["huevo", 100], ["clara", 60], ["espinacas", 50], ["queso_cabra", 15], ["pan_integral", 40]],
    steps: [
      "Saltea las espinacas en una sartén antiadherente hasta que se reduzcan.",
      "Vierte encima los huevos y las claras batidos con sal y pimienta.",
      "Cuando empiece a cuajar, añade el queso de cabra, dobla la tortilla y sirve con el pan.",
    ],
  },
  {
    name: "Shakshuka con pan de pita",
    tags: ["desayuno", "cena"],
    ingredients: [["huevo", 100], ["tomate_triturado", 200], ["pimientos_cebolla", 80], ["aceite_oliva", 5], ["pan_pita", 60]],
    steps: [
      "Sofríe los pimientos y la cebolla en el aceite 5 minutos.",
      "Añade el tomate, comino, pimentón y sal, y cuece 10 minutos hasta que espese.",
      "Haz dos huecos, casca los huevos, tapa y cuece 5-6 minutos. Sirve con el pan de pita.",
    ],
  },
  {
    name: "Huevos al plato con jamón y guisantes",
    tags: ["desayuno", "cena"],
    ingredients: [["huevo", 100], ["jamon_cocido", 40], ["tomate_triturado", 100], ["guisantes", 40], ["pan_integral", 40]],
    steps: [
      "Calienta el tomate con los guisantes 5 minutos en una cazuela apta para horno.",
      "Añade el jamón en tiras y casca los huevos encima.",
      "Hornea a 200 °C 8-10 minutos, hasta que la clara cuaje. Sirve con el pan.",
    ],
  },
  {
    name: "Muffins de huevo con verduras",
    tags: ["desayuno", "snack"],
    ingredients: [["huevo", 100], ["clara", 100], ["pimientos_cebolla", 60], ["espinacas", 30], ["monterey", 15]],
    steps: [
      "Bate los huevos y las claras con sal y pimienta.",
      "Reparte en 3 moldes de magdalena las verduras picadas y el queso, y cubre con el huevo.",
      "Hornea a 180 °C 18-20 minutos. Se conservan 3 días en la nevera.",
    ],
  },
  {
    name: "Revuelto de tofu con espinacas",
    tags: ["desayuno"],
    ingredients: [["tofu", 150], ["espinacas", 40], ["pimientos_cebolla", 60], ["tortilla_trigo", 45], ["aceite_oliva", 5]],
    steps: [
      "Saltea los pimientos y la cebolla en el aceite 4 minutos.",
      "Desmenuza el tofu con las manos, añádelo con cúrcuma, pimentón y sal, y saltea 3 minutos.",
      "Incorpora las espinacas hasta que se reduzcan y sirve con la tortilla caliente.",
    ],
  },
  {
    name: "Espárragos con huevo poché y parmesano",
    tags: ["desayuno", "cena"],
    ingredients: [["esparragos", 120], ["huevo", 100], ["pan_integral", 40], ["parmesano", 8], ["aceite_oliva", 3]],
    steps: [
      "Saltea los espárragos con el aceite y sal 5-6 minutos.",
      "Escalfa los huevos 3 minutos en agua con un chorrito de vinagre, a punto de hervir.",
      "Sirve los huevos sobre los espárragos con el parmesano y el pan tostado.",
    ],
  },
  {
    name: "Avena salada con espinacas y huevo",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 40], ["caldo_pollo", 200], ["espinacas", 40], ["huevo", 50], ["parmesano", 10]],
    steps: [
      "Cuece la avena en el caldo 4-5 minutos, removiendo.",
      "Añade las espinacas el último minuto para que se reduzcan.",
      "Sirve con un huevo a la plancha encima, el parmesano y pimienta negra.",
    ],
  },
  {
    name: "Bol de yogur griego con frutos rojos y granola",
    tags: ["desayuno", "snack"],
    ingredients: [["yogur_griego", 200], ["frutos_rojos", 80], ["granola", 25], ["chia", 5]],
    steps: [
      "Pon el yogur en un bol.",
      "Añade los frutos rojos descongelados.",
      "Termina con la granola y la chía justo antes de comer, para que no se ablanden.",
    ],
  },
  {
    name: "Bol de yogur con mango y pistachos",
    tags: ["desayuno", "snack"],
    ingredients: [["yogur_griego", 200], ["mango", 80], ["pistachos", 12]],
    steps: [
      "Pon el yogur en un bol.",
      "Añade el mango en dados.",
      "Pela y trocea los pistachos y repártelos por encima.",
    ],
  },
  {
    name: "Yogur griego con chocolate negro y frambuesas",
    tags: ["desayuno", "postre"],
    ingredients: [["yogur_griego", 200], ["frambuesas", 80], ["chocolate_negro", 10], ["almendras", 8]],
    steps: [
      "Pon el yogur en un bol y mézclalo con la mitad de las frambuesas aplastadas.",
      "Añade el resto de frambuesas.",
      "Ralla el chocolate por encima y termina con la almendra laminada.",
    ],
  },
  {
    name: "Cottage con piña y nueces",
    tags: ["desayuno", "snack"],
    ingredients: [["queso_cottage", 200], ["pina", 80], ["nueces", 10]],
    steps: [
      "Escurre bien la piña.",
      "Sirve el queso cottage con la piña troceada.",
      "Termina con las nueces y una pizca de canela.",
    ],
  },
  {
    name: "Pudding de chía con frambuesas",
    tags: ["desayuno", "postre"],
    ingredients: [["chia", 25], ["bebida_almendra", 200], ["yogur_griego", 100], ["frambuesas", 80], ["sirope_arce", 5]],
    steps: [
      "Mezcla la chía con la bebida de almendra y el sirope, y remueve bien.",
      "A los 10 minutos vuelve a remover para que no se apelmace y deja en la nevera mínimo 4 horas.",
      "Sirve con el yogur y las frambuesas por encima.",
    ],
  },
  {
    name: "Batido de frutos rojos y avena",
    tags: ["desayuno", "batido"],
    ingredients: [["leche_desnatada", 250], ["yogur_griego", 100], ["frutos_rojos", 100], ["copos_avena", 30]],
    steps: [
      "Pon todos los ingredientes en la batidora.",
      "Tritura 1 minuto hasta que quede fino.",
      "Sirve frío; si usas la fruta congelada no necesita hielo.",
    ],
  },
  {
    name: "Batido proteico de mango",
    tags: ["desayuno", "batido", "snack"],
    ingredients: [["bebida_soja", 250], ["proteina_vegana", 25], ["mango", 100]],
    steps: [
      "Pon la bebida de soja, la proteína y el mango en la batidora.",
      "Tritura hasta que no queden grumos.",
      "Añade hielo si lo quieres más frío.",
    ],
  },
  {
    name: "Batido de cacahuete y dátiles",
    tags: ["desayuno", "batido"],
    ingredients: [["leche_desnatada", 250], ["yogur_griego", 100], ["crema_cacahuete", 15], ["datiles", 20], ["copos_avena", 20]],
    steps: [
      "Deshuesa los dátiles.",
      "Tritura todo en la batidora hasta que quede cremoso.",
      "Sirve frío con una pizca de canela.",
    ],
  },
  {
    name: "Batido verde de piña y espinacas",
    tags: ["desayuno", "batido"],
    ingredients: [["bebida_almendra", 250], ["espinacas", 30], ["pina", 100], ["proteina_vegana", 25], ["lino", 10]],
    steps: [
      "Tritura primero las espinacas con la bebida de almendra.",
      "Añade la piña, la proteína y el lino y vuelve a triturar.",
      "Sirve enseguida con hielo.",
    ],
  },
  {
    name: "Batido de cerezas y yogur",
    tags: ["desayuno", "batido"],
    ingredients: [["leche_desnatada", 250], ["cerezas", 100], ["yogur_griego", 100], ["copos_avena", 20]],
    steps: [
      "Pon todos los ingredientes en la batidora.",
      "Tritura hasta que quede homogéneo.",
      "Sirve frío.",
    ],
  },
  {
    name: "Overnight oats de crema de almendra y cerezas",
    tags: ["desayuno"],
    ingredients: [["copos_avena", 50], ["bebida_almendra", 150], ["yogur_griego", 100], ["crema_almendra", 15], ["cerezas", 80]],
    steps: [
      "Mezcla en un tarro la avena, la bebida de almendra, el yogur y la crema de almendra.",
      "Tapa y deja en la nevera toda la noche.",
      "Sirve con las cerezas partidas por la mitad.",
    ],
  },
];
