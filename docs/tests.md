# Tests del backend

Estado a **2026-10-01**. La parte del front está en `train-fit-front/docs/tests.md`.

## Cómo se ejecutan

```
npm test                      # todo: 1270 casos
node --test components/dietDays/diet-days-nutrition-util.test.js   # uno solo
npm run test:trainer-billing  # solo facturación del profesional (compila los .ts antes)
npm run lint                  # solo errores (verde hoy)
npm run lint:report           # con los 160 avisos heredados
npm run verify                # lint + test
```

El lint llegó en 2026-10 (`.eslintrc.json`, `eslint:recommended` a secas, sin
reglas de estilo). La política error/warn y lo que se arregló para montarlo
están comentados en el propio fichero de configuración.

`npm test` **descubre los ficheros por glob** (`components/**`,
`middleware/**`, `scripts/**`, `integration/**`). No hay lista a mano que mantener, y
`components/util/test-discovery.test.js` falla si aparece un test fuera de esas
raíces o con una extensión que los globs no recogen.

> Hasta 2026-10 la lista sí era a mano: 80 ficheros en disco y 64 en el script.
> Uno de los que se quedaban fuera llevaba meses sin pasar.

8 casos de `trainerPayments/trainer-payments-db.test.js` se **omiten** si no hay
un Mongo en `localhost:27017`. Se saltan solos, no fallan, pero en un CI sin
Mongo esos 8 no cubren nada: levantar un Mongo en el CI es la mejora pendiente
más clara de este fichero.

## Cómo se escribe un test aquí

Todo con `node:test` y `node:assert/strict`, sin frameworks. Tres patrones:

| Patrón | Cuándo | Ejemplo |
|---|---|---|
| Función pura | El módulo no toca Mongo ni red | `dietDays/diet-days-nutrition-util.test.js` |
| `mock.method` sobre el schema | Hay que comprobar QUÉ se escribe en Mongo | `customProducts/custom-product-dao.test.js` |
| `vm` + lista blanca de `require` | Montar `app.js` o una ruta de verdad | `trainerBilling/webhook-route.test.js` |

Convenciones que se siguen en todos:

- **Nombre del caso en castellano y en forma de afirmación**: lo que tiene que
  pasar, no el nombre del método.
- **Un comentario con el POR QUÉ** cuando el caso existe por un bug real o por
  una decisión de producto. Los tests son donde esas decisiones quedan escritas.
- **Los límites, por los dos lados**: justo en el tope y justo por encima.
- **Los datos a medias cuentan**: `null`, `undefined`, `0`, `""`, texto donde se
  espera número, y el documento sin poblar.

## Espejos entre front y back

Hay aritmética duplicada a propósito. Cuando se separa, el cliente y su
profesional ven números distintos de lo mismo y nadie se entera, así que los
tests de las dos mitades afirman **los mismos números con los mismos datos**:

| Cálculo | Backend | Front |
|---|---|---|
| Macros de una comida y de una receta | `dietDays/diet-days-nutrition-util.test.js` | `shared-core/.../services/nutrition-math.test.cjs` |
| Seguimiento del día (pautado vs. consumido) | `dietDays/diet-days-nutrition-util.test.js` | `shared-core/.../diet-day/diet-day-totals.test.cjs` |
| Lista de la compra | `dietDays/shopping-list-service.test.js` | `shared-core/.../utils/shopping-list.test.js` |

Las diferencias que se dejan a propósito están escritas como casos con el
prefijo `DIFERENCIA CONOCIDA`, para que salten si alguien cambia un lado.

Dentro del backend, la fusión de ingredientes de una receta existe una sola
vez (`dietDays/diet-days-nutrition-util.js`, pura). `recipes/recipe-merge.js`
solo sanea lo que llega; los dos leen los campos pisables del catálogo único
`util/nutrient-fields.js`.

## Qué está cubierto

37 de 58 componentes tienen tests (46.152 de 53.433 líneas). Lo más denso está
en lo que cuesta dinero o es difícil de deshacer: `trainerBilling`,
`trainerPayments`, `trainerCheckins`, `dietTemplates`, `coachAlerts`, `workouts`,
`users`, `auth`.

## Qué NO está cubierto

21 componentes, 7.281 líneas. Por tamaño:

| Componente | Líneas | Por qué importa |
|---|---|---|
| `exercises` | 1135 | Catálogo de músculos y búsqueda de ejercicios |
| `products` | 936 | Búsqueda, código de barras y deduplicado del catálogo |
| `customRecipes` | 635 | Escritura de las recetas de una comida |
| `formChecks` | 587 | Revisiones de técnica: cupo semanal y caducidad a 90 días |
| `progressMedia` | 527 | Qué ve el profesional de las fotos del cliente |
| `techniqueVideos` | 414 | Biblioteca del profesional |
| `trainerTasks` | 384 | Tareas y hábitos pautados |
| `supplements` | 353 | Pauta de suplementos |
| `notifications` | 312 | Avisos al cliente |
| `envManager` | 281 | Operación del servidor |
| `trainerIntakeConfig` | 267 | Formulario de alta que configura el profesional |
| `coachTasks` | 234 | Tareas del profesional |
| `reviewQueue` | 161 | Cola de revisión |
| `mealSnippets` | 95 | Comidas guardadas |
| `gitManager`, `trainerNotes`, `serverManager`, `appVersion` | 181 | Piezas pequeñas |

**Por dónde seguir**, en orden de lo que más duele que falle en silencio:

1. `products` — el deduplicado y la búsqueda deciden qué alimento apunta el
   cliente; un fallo aquí le hace registrar otra cosa.
2. `formChecks` — el cupo semanal y el borrado a 90 días son reglas con fecha:
   si el cálculo se desvía, se borran vídeos antes de tiempo.
3. `progressMedia` — decide qué fotos del cliente ve su profesional. Un fallo
   aquí es un problema de privacidad, no un número mal.
4. `customRecipes` — es la pareja de escritura de `recipes`, que ya está cubierto.
5. `exercises` — el catálogo de músculos alimenta el volumen por grupo.
