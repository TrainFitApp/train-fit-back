# `refactor-claude` → `main` (back)

Qué trae la rama `refactor-claude` respecto a `main` y qué hay que hacer para fusionarla y desplegarla en producción.
Estado a **2026-09-25**. La parte del front está en `train-fit-front/docs/refactor-claude.md`.

## Resumen

- **91 commits** sin merges (sangovis98 55, Davvidar 21), del 2026-07-31 al 2026-09-21. 316 ficheros, +41.000 líneas.
- `main` (2026-08-21) es ancestro directo de `refactor-claude`, así que la fusión es **fast-forward**, sin conflictos.
- `main` es el back de la **app del cliente** (dietas, entreno, productos, facturación). `refactor-claude` le añade:
  1. Todo el **lado entrenador (Coach Pro)**: relación con clientes, intake, plantillas, fases, check-ins, alertas, reglas, protocolos, adherencia, etc.
  2. Un **modelo de nutrición rehecho**: sin la colección `diets`, con plantillas de menús, fases y semanas.
- Las apps ya instaladas siguen funcionando: `components/diets/` se queda como **capa de compatibilidad** con las mismas rutas `/diets/*`.

## Qué trae, por dominio

### Relación entrenador ↔ cliente
- `trainerClients/`: invitaciones, estados de la relación por ámbito (entrenamiento y nutrición), paginación de la cartera, cancelación e historial de relaciones revocadas, y conteo de clientes activos históricos.
- **Intake**:
  - `trainerIntakeConfig/`: qué campos pide cada entrenador, más sus preguntas propias.
  - `clientIntake/`: el cuestionario del cliente. Confirma el perfil (peso, pasos, actividad, frecuencia), el objetivo y los `dietaryFlags`, y lo guarda en `User`, `Anthropometry` y `ClientNutritionPreferences`.
- `notifications/`: avisos in-app para el entrenador y el cliente. Se quitó el envío push (sale la dependencia `google-auth-library`).
- `clientCoachView/`: la pestaña "Coach" del cliente.
- `trainerNotes/`, `trainerPayments/` (cobros apuntados a mano) y `trainerTasks/` (tareas y **hábitos** del cliente con sus `taskcompletions`).

### Nutrición (el cambio más grande)
- **5 colecciones**: `diettemplates`, `dietdays`, `meals`, `customproducts` y `customrecipes`. Desaparece `diets`.
  - El dueño del día pasa a `DietDay.userId`.
  - La nota fijada pasa a `User.dietPinnedNote`.
  - Se quita `User.dietInUse`.
- **`DietTemplate`** (`dietTemplates/`) es siempre una lista de **menús** (`menus[].meals[].alternatives[]`). El cliente elige un menú cada día y se guarda en `DietDay.menuName`. El documento tiene tres papeles:
  - Plantilla de biblioteca: solo `trainerId`. Con `verified: true` es una dieta "de fábrica" de administración.
  - Plantilla propia de un cliente: `ownerClientId`.
  - **Copia congelada asignada**: `clientId`, `startDate`, `endDate`, `status` y `supersededBy`. **La copia es la asignación**: ya no existe la colección `planassignments`.
- **Fases y semanas** (`planAssignments/`, sin schema propio):
  - Una fase dura hasta que empieza la siguiente.
  - Se parte en **semanas naturales** de lunes a domingo (`week-window.js`).
  - El primer documento de la fase guarda `phaseName`, `phaseTarget`, los g/kg y el snapshot `phaseNeed`.
  - `week-progression.js` propone las kcal de la semana siguiente según el peso. Siempre es un borrador que confirma el entrenador.
- **Necesidad del cliente** (`nutritionalGoals/nutrition-target-resolver.js`): Mifflin-St Jeor. Los pasos salen del hábito de pasos (`trainerTasks`) o, si no, del perfil.
  - El entrenador **ya no asigna objetivos nutricionales**: la meta la marcan las fases.
- **Sugerencias de dieta** (`diet-suggestion.js`, `diet-suitability.js`): ranking por kcal y macros. Las restricciones alimentarias no descartan ninguna dieta, solo la ponen por detrás.
- **Pautado vs. consumido**: `assignedQuantity`, `assignedByTrainerId` y `consumed` en `CustomProduct`/`CustomRecipe`. Lo pautado es de solo lectura para el cliente.
- **Alternativas de comida**: `Meal.alternatives` + `chosenAlternativeIndex`. La comida nace con la opción 1 aplicada. El cliente las usa por las rutas de `mealProposals/`.
- **Saltar un día**: `DietDay.skipped` (`diet-skips.js`).
- **Adición rápida** (2026-10): `CustomProduct.name` + `quickAdd` — una línea que el cliente apunta con sus macros a mano, sin `product` del catálogo detrás. Se guarda con `quantity` 100 y los macros en los campos "por 100 g", así que suma por la vía de siempre (`ingredientMacros`) sin ningún caso especial. Sin `product`, queda fuera de los recientes (`diet-dao.js#getRecentMealProducts`, `$unwind` del producto) y de la lista de la compra, que se calcula desde el plan.
- `mealSnippets/` (comidas guardadas del entrenador), `nutritionPreferences/` (preferencias y restricciones del cliente) y la lista de la compra (`shopping-list-service.js`).
- **Retirado dentro de la propia rama** (nunca llegó a main): intercambios de alimentos, `anthropometryRequests` y los modelos de "ciclos" y "revisiones".

### Entrenamiento
- **Plantillas de rutina** del entrenador: una `Table` sin `userId` es una plantilla, y al asignarla se copia al cliente. `Table.assignedByTrainerId`.
- `workoutTemplates/`: un `Workout` con `trainerId` y sin Split es una plantilla. `Workout` gana `blocks`, `rounds`, descansos, `readinessPre`/`sorenessPre`/`perceivedEffortPost`, `isPlannedRestDay`…
- `routineAssignments/`: fases de rutina (tabla X desde la fecha Y), con proyección entre asignaciones.
- **Ejercicios propios del entrenador**: crear, editar y borrar (`customExercises/`, `exercises/`). Tienen notas para el cliente (`clientNotes`).
- **Planificador**: `Split` con `purpose` y `objective`, series con `restSeconds`, `exerciseScores/` (IEM/IEA), `painLog/` (dolor y umbrales) y comparación de microciclos.

### Check-ins
`trainerCheckins/`:
- `CheckinTemplateDefinition` es el formulario: campos del catálogo, obligatorios y preguntas propias.
- `CheckinSchedule` es la programación por cliente: `once/daily/weekly/monthly` más "cada N".
- Las ocurrencias **se calculan al consultar**. No hay cron.
- `CheckinResponse` guarda una respuesta por ocurrencia, editable mientras siga abierta, y va ligada a la semana de dieta.
- Los datos corporales también se escriben en `Anthropometry`, que gana perímetros bilaterales L/R, masas y `checkinSources`.
- Agenda y calendario: `checkin-agenda-service.js`.

### Coach Pro
- `coachAlerts/`: alertas diarias **sin cron**. La primera lectura del día de cada entrenador (panel, Cartera o resumen del cliente) evalúa y **escribe** en la BD; `POST /trainer/alerts/evaluate` fuerza una evaluación.
- `coachRules/` (reglas WHEN/IF/THEN), `coachProtocols/`, `coachTasks/` y `planChanges/` (historial de cambios con motivo).
- `clientProgress/`: adherencia en 4 dimensiones, Cartera (roster) y progreso.
- `supplements/`.
- Catálogos **duplicados a mano** con `shared-core` del front (check-in, agujetas, dolor, puntuaciones), cada uno con su test de paridad.

### Cobros entrenador → cliente (2026-09-27, rama `david`)
Detalle completo en `components/trainerPayments/README.md`.
- `trainerpayments` pasa a ser el **cobro** (obligación) con pagos **embebidos**, saldo en céntimos (`amountCents − receivedCents − cancelledCents`) y escritura compare-and-swap por `revision`. Mismos `_id`; los campos antiguos se mantienen sincronizados.
- **Cuota** recurrente única por pareja en `trainerpaymentprofiles` (segmentos, precio por vigencia, pausa/reanudación, fin); preferencias del entrenador en `trainerpaymentsettings` (zona, hora, hitos −3/0/+3).
- Núcleo puro en **TypeScript estricto** (`components/trainerPayments/src` → `.build/trainer-payments`), como trainerBilling pero sin acoplarse a él.
- Rutas nuevas `/trainer/payments/*` con autorización financiera propia (cliente activo con plazas; antiguo cliente solo para cerrar su deuda). Las rutas antiguas `/trainer/clients/:id/payments` siguen, con adaptador seguro (`LEGACY_CONFLICT`).
- Avisos in-app `payment_reminder` (sin push) con job cada 15 min; `payment_created` ya solo sale si el entrenador activó los avisos del cliente. `GET /coach/dashboard` devuelve el saldo restante.

### Transversal
- Auth: tests del refresh token (`auth/refresh-flow.test.js`).
- Facturación: entitlements de entrenador en RevenueCat (`trainer_pro` / `trainer_unlimited`) y `User.professionalPremium`.
- CORS: orígenes para livereload en dispositivo y `CORS_OPEN=1` solo en desarrollo.

## Modelo de datos

| | Colecciones |
|---|---|
| **Nuevas** | `trainerclients`, `clientintakes`, `trainerintakeconfigs`, `clientnutritionpreferences`, `diettemplates`, `notifications`, `trainertasks`, `taskcompletions`, `trainernotes`, `trainerpayments`, `coachalerts`, `coachrules`, `coachprotocols`, `coachtasks`, `planchanges`, `routineassignments`, `checkintemplatedefinitions`, `checkinschedules`, `checkinresponses`, `supplements`, `exercisescores`, dolor (`PainEntry`, `PainThreshold`) |
| **Eliminadas** | `diets` (la migra `migrate-nutrition-model.js`) |

Cobros (2026-09-27): nuevas `trainerpaymentprofiles` y `trainerpaymentsettings`; `trainerpayments` gana campos (`schemaVersion`, `amountCents`, `dueDay`, `payments[]`, `status`…), todos aditivos. Tipo nuevo `payment_reminder` en `notifications`.

| Schema | Campos nuevos | Campos quitados |
|---|---|---|
| `User` | `dietPinnedNote`, `dietEnabled`, `professionalPremium` | `dietInUse`, `archivedDiets`, `archivedTables` |
| `DietDay` | `userId` (+ índice `{userId, date}`), `skipped`, `menuName` | `steps` ⚠️ |
| `Meal` | `trainerId`, `assignedByTrainerId`, `completed`, `alternatives`, `chosenAlternativeIndex`, `alternativesTrainerId` | |
| `CustomProduct` / `CustomRecipe` | `assignedQuantity`, `assignedByTrainerId`, `consumed`; en `CustomProduct` además `name` y `quickAdd` (adición rápida, 2026-10) | |
| `Anthropometry` | perímetros L/R, `shoulders`, masas, `checkinSources` | |
| `NutritionalGoal` | `fiberGTotal`, `source`, `updatedByTrainerId` | |
| `Recipe` | `tags` | |
| `Split` / `Workout` / `Table` / `CustomExercise` | ver el apartado "Entrenamiento" | |

⚠️ `DietDay.steps` existía en `main` y se quitó (commit `fff18d9`) **sin migración**. El dato sigue en Mongo pero ya no lo lee nadie. Antes de desplegar, comprobar si hay datos en producción con `db.dietdays.countDocuments({steps: {$exists: true}})`.

## API

Rutas nuevas registradas en `routes/index.js`:
- Bajo **`/trainer`**: clientes e invitaciones, check-ins, configuración del intake, alertas, tareas del coach, progreso, reglas, protocolos y puntuaciones.
- En la raíz: plantillas de dieta, snippets, asignaciones de plan, rutinas asignadas, plantillas de workout, tareas y hábitos, dolor, suplementos, objetivos del entrenador, notificaciones, preferencias de nutrición, vista coach y propuestas de comida (`/diets/...`).

**Compatibilidad**: `/diets/:id` sigue existiendo para las apps instaladas. El `:id` que mandan se interpreta como el id del usuario. `remoteConfig.forceUpdate` (`minVersionIos/Android/Web`) permite forzar la actualización si hiciera falta.

## Crons y variables de entorno

| Cron | Hora | Se apaga con |
|---|---|---|
| Conciliación de facturación RevenueCat | 04:00 (ya estaba) | `BILLING_RECONCILIATION_CRON` cambia la hora |
| Conciliación de Stripe de trainers | cada 15 min | sin `STRIPE_KEY` |

Cuotas y avisos de cobro (`trainerPayments/`) **no tienen cron**: se ponen al día en la primera lectura de cada usuario (sus avisos, el contador, el Coach o Cobros) y quedan en memoria hasta el siguiente hito o medianoche. Ver `components/trainerPayments/README.md`.

No hay **ninguna variable nueva obligatoria**. Opcionales: `CORS_OPEN` (solo desarrollo), `REVENUECAT_TRAINER_PRO_ENTITLEMENT_ID` y `REVENUECAT_TRAINER_UNLIMITED_ENTITLEMENT_ID` (tienen valor por defecto), y `VERIFY_BASE_URL` (solo para los scripts `verify-*`).

## Migración de la base de datos de producción

> **Propuesta sin probar.** Todos los scripts se han escrito y ejecutado contra `pre`, nunca contra una copia de producción. Antes de nada: **backup de producción** y `--dry-run` de cada paso, comparando los recuentos.

Producción viene de `main`, así que **no tiene** `diettemplates`, `mealproposals`, `dietexceptions`, `planassignments` ni `foodexchangegroups`. Casi todo lo que migra de verdad es el paso 1.

| # | Script | Qué hace en producción |
|---|---|---|
| 1 | `migrate-nutrition-model.js` (`npm run migrate:nutrition-model[:dry-run]`) | **Imprescindible.** Rellena `dietdays.userId` desde `diets.dietsDay[]`, copia `diets.pinnedNote` a `users.dietPinnedNote`, borra `diets` y quita `users.dietInUse`. Con `--keep-old` no borra `diets`. |
| 2 | `cleanup-nutrition-legacy.js` | Limpia la estructura huérfana que haya quedado (`diets`, `dietInUse`). |
| 3 | `migrate-anthropometry-lateral-backfill.js` | Aditivo: copia bíceps y gemelo antiguos a los dos lados L/R. |
| 4 | `verify-nutrition-model.js` (`npm run verify:nutrition-model`) | Comprueba el modelo con los DAOs reales. |
| 5 | `migrate-trainer-payments-v2.js` (`npm run migrate:trainer-payments[:dry-run]`) | Aditivo y repetible: cobros antiguos a la forma nueva (movimiento equivalente para los pagados, sin avisos). Reporta y NO convierte otras divisas, decimales raros, fechas ambiguas y huérfanos. Ver `components/trainerPayments/README.md`. |
| — | `migrate-pautado-assigned-quantity`, `migrate-meal-alternatives-default`, `migrate-diet-template-drop-nulls`, `unassign-trainer-goals`, `drop-food-exchanges` | Arreglan datos que solo existieron en `pre`. En producción el `--dry-run` debería dar 0; si da 0, no hace falta ejecutarlos. |

Notas:
- Los pasos 3 y 4 de `migrate-nutrition-model.js` todavía escriben `meals.pendingAlternatives` (el nombre antiguo; el schema actual usa `alternatives`). En producción no afecta porque no hay `mealproposals` ni `dietexceptions`, pero conviene corregirlo si se vuelve a usar.
- Scripts que **ya estaban en `main`** (`migrate-dietday-dates`, `migrate-weights-to-anthropometry`, `migrate-tables-unify`, `migrate-users-remove-tables-array`, `migrate-normalize-emails`, `migrate-sets-cardio-fields`, `migrate-exercise-description-steps`): confirmar si ya se ejecutaron en producción.

**Nunca contra producción:**
- `reset-weeks.js`: **borra TODOS los `DietDay`** (el diario de cada cliente), todas las `DietTemplate` y todas las `CheckinResponse`. Solo sirvió para limpiar `pre` al pasar de "revisiones" a semanas.
- Los `seed-*.js` (datos de demo) y `reassign-mock-client-trainer.js`.
- Los `verify-*.js`: son autolimpiantes, pero **escriben** en la BD.

## Orden de despliegue
1. Backup de producción → `--dry-run` de los pasos 1 a 4 → migración.
2. Desplegar el **back** (`refactor-claude` ya fusionada en `main`). Las apps de cliente ya publicadas siguen funcionando gracias a `/diets/*`. Antes de arrancar: `npm run build:ts` (compila trainerBilling y trainerPayments; PM2 no ejecuta `prestart`).
3. Publicar la nueva versión de la **app del cliente** y la **app del entrenador** (nueva en las tiendas). Ver el doc del front.

## Pendiente antes de fusionar
- **Sin commit**: `package.json` y `package-lock.json` añaden `cross-env` para que `npm run serve` funcione en Windows.
- `package.json` tiene `migrate:diet-phases`, que apunta a `scripts/migrate-diet-phases.js`, un fichero que **no existe**.
- Documentos citados en el código que no existen: `docs/plan-semanas.md`, `docs/plan-info-calculo-fase.md`, `MASTER_BACKLOG.md` y `modelos-de-datos/…`.
- `npm test` usa una lista explícita de ficheros: ejecutarlo antes de fusionar.
- Ramas aún **sin integrar**:
  - `pagos` (Davvidar): Stripe para entrenadores, en TypeScript.
  - `fixes-cliente` (Davvidar).
  - `resumen-checkins`.
  - `refactor-checkins`, solo en local (6 commits sin push): la unificación de check-ins con `CheckinRequest`, pensada todavía sobre "ciclos".
  - Decidir cuáles entran antes de pasar a `main`.
