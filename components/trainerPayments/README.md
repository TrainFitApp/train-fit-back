# Cobros entrenador → cliente (`trainerPayments`)

Agenda de cobros del ENTRENADOR: lo que sus clientes le pagan fuera de TrainFit
(Bizum, transferencia, efectivo…). Aquí solo se anota: no se mueve dinero, no
hay pasarela, facturas ni impuestos. Es un dominio distinto de `trainerBilling`
(lo que el entrenador paga a TrainFit con Stripe) y de RevenueCat (premium del
cliente): no comparten modelos ni rutas.

Especificación funcional: `docs/ESPECIFICACION-COBROS-TRAINERS.md` (raíz del
workspace, sin versionar).

## Tres conceptos

| Concepto | Dónde vive | Ejemplo |
|---|---|---|
| **Cuota** (regla) | `trainerpaymentprofiles.plan` — UN perfil por pareja entrenador–cliente, sean cuales sean los scopes | 60 € cada mes desde el 5 oct |
| **Cobro** (obligación) | `trainerpayments` — la colección de siempre, ampliada | 60 € que vencen el 5 nov |
| **Pago registrado** | `trainerpayments.payments[]` (embebido en su cobro) | 20 € por Bizum recibidos el 7 nov |

`saldo = importe vigente − pagos válidos − saldo anulado`. `receivedCents` y
`cancelledCents` se guardan en el MISMO documento y en la MISMA escritura que
los movimientos (`verifyCharge` comprueba la equivalencia; hay test de
propiedades).

## Código

- `src/*.ts` — núcleo PURO en TypeScript estricto (`npm run build:trainer-payments`
  → `.build/trainer-payments`; `npm run build:ts` compila también trainerBilling y
  es lo que ejecutan `prestart`, `preserve` y `pretest`). Sin Mongo ni Express:
  - `money.ts` importes en céntimos (máx. 2 decimales, máx. 1.000.000), idempotencia.
  - `calendar.ts` días civiles, recurrencia (siempre desde el ancla: 31 → 28/29 feb → 31 mar;
    cada N semanas ≠ cada N meses), zonas IANA y cambio de hora.
  - `ledger.ts` lectura del documento, pagos, correcciones, anulación y
    recuperación de saldo, edición, previsiones.
  - `plan.ts` cuota: alta, precio por vigencia, recalendarizar, pausa/reanudación, fin,
    materialización y reconciliación de previsiones.
  - `reminders.ts` política de hitos de aviso.
  - `dto.ts` contratos de salida (entrenador, cliente, tarjeta del Resumen).
- `core.js` carga el núcleo compilado. `*-schema.js`, `trainer-payment-dao.js`,
  `trainer-payment-mapper.js`, `trainer-payment-service.js`,
  `trainer-payment-overview-service.js`, `trainer-payment-reminder-service.js`,
  `trainer-payment-access.js`, `trainer-payment-controller.js`,
  `trainer-payment-routes.js`: capa CommonJS (routes → controller → service → dao).

## Consistencia

- **Compare-and-swap por `revision`**: toda operación lee el cobro, el núcleo calcula el
  estado siguiente y la escritura solo se aplica si nadie lo tocó entretanto (hasta 5
  reintentos). Dos pagos simultáneos no superan el saldo; pago contra cancelación: gana
  uno. Sin transacciones (funciona igual en un Mongo sin réplica).
- **Idempotencia persistente**: cada pago guarda su `operationId` y la huella de su carga;
  el resto de operaciones de un cobro y de la cuota, en `operations[]`. Mismo id + misma
  carga → devuelve el estado actual; misma id + otra carga → 409 `IDEMPOTENCY_CONFLICT`.
  El alta de un cobro puntual usa el índice único `(trainerId, createOperationId)`.
- **Vencimientos únicos**: clave `perfil:segmento:día` con índice único parcial. Reanudar o
  recalendarizar abre un segmento nuevo; un cambio de precio no.
- **Horizonte**: solo se materializan vencimientos hasta HOY + 7 días (cursor
  `plan.materializedThrough`). Una cuota futura sin dinero es una **previsión**: no suma en
  "pendiente", y pausar/finalizar/recalendarizar la anula (`status: void`, con motivo).
- **El precio no depende de cuándo se materialice**: el precio de un día sale de `plan.prices` (vigencia por
  fecha); la reconciliación reajusta las previsiones sin pagos ni edición manual. Lo
  vencido y lo que tiene pagos no se toca.
- Estados independientes: `status` (open / settled / cancelled / void) y temporalidad
  (vencido / hoy / próximo), calculada con el "hoy" de la zona del entrenador.

## Avisos (solo in-app)

Tipo `payment_reminder` en `notifications` (destinatario entrenador o cliente). Sin push,
email ni notificaciones del sistema operativo.

**Sin cron** (como las alertas del coach): no hay ningún proceso programado ni cambios en
`bin/www`. La primera lectura que los necesita pone al día a ESE usuario
(`trainer-payment-reminder-service.js`): materializa sus cuotas y crea los avisos cuyo hito
ya pasó. Entrenador: `GET /trainer/notifications/mine[/unread-count]`,
`/trainer/payments/summary` y `/overview`. Cliente: `GET /notifications/mine[/unread-count]` y
`/coach/dashboard`. La ficha (`/payments/clients/:id`) materializa su pareja al leer.

- Después no vuelve a la BD hasta `nextAt`: la próxima medianoche en la zona del entrenador
  (el horizonte avanza) o el próximo hito de un cobro abierto, lo que llegue antes. Memoria por
  proceso; perderla (reinicio) solo repite una pasada idempotente.
- Toda escritura de cobros (`trainer-payment-controller.js#write`, también el contrato
  antiguo) invalida la memoria de la pareja; cambiar zona, hora o días, la de todos.
- Sin lecturas no se escribe nada: un aviso de las 09:00 nace cuando el usuario abre la app
  después de esa hora (solo in-app: lo ve igual de pronto). Con varios procesos, un cobro
  escrito en otro se procesa como tarde a la medianoche siguiente.
- Peticiones o procesos simultáneos no duplican: `dedupeKey` único por cobro + destinatario +
  revisión del vencimiento + hito, y registro de hitos con `$push` condicionado.

**Política exacta de hitos** (`reminders.ts`):

1. Hitos por defecto −3, 0 y +3 días a las 09:00 de Europe/Madrid (Configuración > Cobros:
   días de −7 a +30, máx. 6; hora; zona IANA persistida por entrenador). Un perfil puede
   sobrescribir los días (`reminderOffsets`).
2. Solo cobros abiertos con saldo > 0; se revalidan justo antes de guardar (y, para el
   cliente, relación activa y preferencia activada). Si un pago o una baja llegan en la
   misma carrera, el aviso nace resuelto o se retira.
3. **Ventana**: ningún hito anterior a `remindersFrom` (alta del cobro, inicio del segmento
   de la cuota, cambio de vencimiento, reapertura, migración) ni, para el cliente, a su
   `enabledAt`. Esos quedan como omitidos.
4. Si hay varios hitos alcanzados sin registrar (días sin abrir la app), sale solo el más reciente
   dentro de la ventana y los anteriores quedan omitidos.
5. Al liquidar, cancelar o anular un cobro, sus avisos pasan a `read` con
   `payload.resolution`; al cambiar el vencimiento, los de la revisión anterior se resuelven
   como `rescheduled`. Al listar avisos se añade `payload.current` (saldo y estado de
   AHORA): un aviso antiguo nunca afirma una deuda que ya no existe.
6. El entrenador recibe avisos de toda deuda válida (puntual, anterior a una pausa, a un
   fin de cuota o de un antiguo cliente). El cliente solo si el entrenador los activó
   (desactivados por defecto, también al migrar y al reinvitar) y con relación activa.
7. Payload sin nota privada, método ni movimientos: `{chargeId, dueDay, dueRevision, offset,
   milestone, balanceCents, currency, concept}`.

`payment_created` (cliente) solo sale si sus avisos están activos y el vencimiento no es pasado.

## Permisos

`/trainer/payments/*` solo con `auth(["trainer"])`; el entrenador sale de la sesión.
`trainer-payment-access.js` (por cliente):

- **Cliente activo** (algún scope activo): todo; las escrituras respetan las plazas
  (`CLIENT_READ_ONLY`), igual que el resto de la ficha.
- **Antiguo cliente** (solo relaciones revocadas): leer y cerrar su deuda (registrar,
  corregir, anular, recuperar, editar un cobro). Nunca crear cuotas, cobros nuevos ni
  activar avisos. No relaja `requireActiveClient` ni el guard de intake.
- Otro entrenador / sin relación / el propio entrenador: 403. Toda consulta filtra por
  `trainerId` + `clientId`, nunca solo por id de cobro.

Baja: al revocar el ÚLTIMO scope activo con ese entrenador se finaliza la cuota
(`relation_ended`), se anulan sus previsiones y se apagan los avisos del cliente; la deuda
se queda. Si solo termina entrenamiento y sigue nutrición, no se toca nada. Cada puesta al
día lo vuelve a comprobar. Reinvitar no reactiva nada (el perfil es el mismo).

**Borrado de cuenta ≠ baja**: borrar un `User` sigue borrando en cascada sus cobros,
perfiles y preferencias (`users/schema.js`), como el resto de datos de la relación. No se
conserva histórico tras borrar una cuenta.

## API

| Método | Ruta (`/api/trainer/payments/…`) | Acceso |
|---|---|---|
| GET | `summary` | contrato del dashboard (saldo real; serie por VENCIMIENTO + `receivedSeries`) |
| GET | `overview?search&state&relation&from&to&page&limit` | lista global + totales de todo el conjunto |
| GET/PUT | `settings` · POST `settings/preview` | zona, hora e hitos |
| GET | `clients/:clientId` · `clients/:clientId/summary` | activo o antiguo |
| POST | `clients/:clientId/plan/preview` | activo |
| PUT | `clients/:clientId/plan` · POST `plan/pause` · `plan/resume` | activo con plaza |
| POST | `clients/:clientId/plan/end` | activo o antiguo |
| PUT | `clients/:clientId/preferences` | activo con plaza |
| POST | `clients/:clientId/charges` | activo con plaza (vencimiento pasado exige `confirmPastDue`) |
| GET/PATCH | `clients/:clientId/charges/:chargeId` | lectura / corrección |
| POST | `…/charges/:chargeId/payments` · `…/payments/:paymentId/correct` · `…/cancel` · `…/restore` | cierre de deuda (activo con plaza o antiguo) |

Errores: `{code, message, details}`; p. ej. `AMOUNT_EXCEEDS_BALANCE` (422, `details.balanceCents`),
`REOPEN_CONFIRMATION_REQUIRED` (409, confirmar `confirmBalanceCents`), `BALANCE_CHANGED`,
`CHARGE_CLOSED`, `START_OVERLAPS_EXISTING`, `FORMER_CLIENT_RESTRICTED`, `IDEMPOTENCY_CONFLICT`.

`GET /coach/dashboard` (cliente) devuelve en `pendingPayments` el saldo restante de cada cobro
(`chargeId`, `balanceCents`, `currency`, `dueDay`, `concept`, `trainerName`); nunca notas ni
pagos. `GET /coach/professionals/:trainerId/payments` (cliente, solo con relación activa; 404 si
no) es su ficha en Coach > Tus profesionales: cuota, resumen y cada cobro con sus pagos válidos
(importe y día). `client-ledger-view.js` (PURO, con test) quita notas, método, autor, ajustes,
anomalías, pagos anulados y previsiones. `GET /trainer/payments/summary` (panel «Hoy») va en céntimos: `pendingCents`,
`overdueCents`, `dueSeries` (por vencimiento) y `receivedSeries` (por recepción).

## Migración (`scripts/migrations/13-trainer-payments.js`)

Es el paso 13 del runner único del modelo de datos:

```bash
npm run migrate:dry-run   # informe, sin escribir
npm run migrate
```

Repetible y sin avisos. Lleva toda la colección a la forma de este README (el código ya no lee
otra): los cobros planos (`amount`/`dueDate`/`paidAt`) se convierten con el mismo `_id`
(`scripts/lib/trainer-payment-v1.js`). Día civil: medianoche UTC → ese día; medianoche de
Madrid → ese día; otra hora → día en Madrid, marcado ambiguo si difiere del UTC. Pagado → un
pago `method: unknown`, `receivedDaySource: marked_paid` (cuándo se marcó, no cuándo llegó el
dinero), `source: migration`, sin fecha ni autor de anotación inventados. Se convierten TODOS:
otra divisa, decimales anómalos y fechas inválidas o ambiguas quedan en `anomalies` y la app
pide revisarlos. No deduce cuotas. También limpia la forma de transición (`origin: legacy`,
pagos `legacy_toggle`/`legacy_marked_paid`, `schemaVersion`, `legacy`, `amount`, `dueDate`,
`paidAt`), los avisos de cobro (`payload.amount/dueDate` → `amountCents/dueDay`) y el índice por
`dueDate`. Compara importe, recibido, pendiente y nº de pagos por entrenador y divisa
antes/después; sale con código 1 si no coinciden. Test: `scripts/migrate-trainer-payments.test.js`.

## Tests

- `trainer-payments-core.test.js` (núcleo puro) y `trainer-payments-http.test.js` (acceso y
  contrato HTTP, sin BD): en `npm test`.
- `npm run test:trainer-payments:db`: Mongo LOCAL aislado (por defecto
  `mongodb://127.0.0.1:27017/trainfit_payments_test_<pid>_<ts>`, que se borra al terminar;
  `TRAINER_PAYMENTS_TEST_MONGO_URI` solo acepta loopback y `trainfit_payments_test*`). Cubre
  HTTP real con tokens firmados en el test, permisos, concurrencia, índices únicos, avisos al
  leer con reloj inyectado, memoria e invalidación. Sin Mongo local, se omite.

## Despliegue

1. `npm ci` y `npm run build:ts` (si PM2 arranca `bin/www` sin prestart, sin
   `.build/trainer-payments` los endpoints de cobros dan 503 `PAYMENTS_UNAVAILABLE` y el log
   lo avisa una vez).
2. Arrancar: Mongoose crea las colecciones nuevas y los índices (parciales, sin conflictos
   con los datos actuales).
3. `npm run migrate:dry-run`, revisar anomalías y huérfanos del paso 13, y después sin `--dry-run`.
4. Publicar las apps (Trainers, cliente) a la vez que el back, con actualización forzada: las
   versiones anteriores usaban rutas y campos que ya no existen.

## Limitaciones conocidas

- Avisos locales antiguos (Capacitor) programados en otro dispositivo solo se cancelan cuando
  ese dispositivo abre la versión nueva de Trainers; se reconocen por título "TrainFit" y cuerpo
  "Recuerda cobrar a …" (el resto de notificaciones locales se conserva).
- Solo EUR para cobros nuevos; otras divisas de cobros convertidos se muestran aparte y no se suman.
- Los días de aviso configurables en la UI son "N días antes / el día / N días después"; la API
  admite hasta 6 hitos.
