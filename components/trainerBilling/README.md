# Facturación Trainers

> **02/10/2026 — Facturación por plazas.** Catálogo Free (3 plazas, +3 €/plaza/mes, hasta 12), Inicio (29 €, 20, +1 €, hasta 40), Profesional (49 €, 50, +0,80 €, hasta 125) y Escala (109 €, 150); anual = 10 mensualidades, también en las plazas. Sustituye a Pro/Growth/Scale. Los entrenadores solo se suscriben por Stripe (fuera RevenueCat de entrenadores y `trainer_unlimited`).
> - **Cuándo se aplica:** subir de plan, pasar a anual o añadir plazas (mensuales o anuales) se cobra al momento y se da al pagar (`always_invoice` + `pending_if_incomplete`; decisión 2026-10-03: aplazar la prorrata de las plazas mensuales dejaba sin cobrar a quien cancelaba antes de renovar); bajar de plan, quitar plazas o pasar a mensual espera a la renovación (calendario).
> - **Reducir nunca se bloquea** por tener más clientes que plazas: la propuesta dice cuántos quedarán en solo lectura y, al aplicarse, el entrenador elige quién sigue activo (`trainer-seat-service`). Las invitaciones pendientes reservan plaza; si no cabe, no se cancelan pero no se pueden aceptar (`SEAT_UNAVAILABLE`). Altas y aceptaciones van bajo el bloqueo por entrenador.
> - **Reembolso de una subida** (plan o plazas): vuelve el estado anterior sin prorrateo; reembolsar plazas no toca la cuota.
> - **Condiciones:** al contratar las acepta Checkout (`consent_collection`); al confirmar un cambio en la app, el diálogo lo dice con el enlace y la API exige recibir la URL vigente (`TERMS_CHANGED` si cambió). Cada aceptación queda en `termsHistory` (via `checkout`/`change`, sesión o propuesta, URL). Publicar cada versión en su propia URL para saber qué texto aceptó cada entrenador.
> - **Configuración:** cinco variables y precios por lookup key; solo Managed Payments; portal predeterminado. Lo que sigue por debajo es historia: donde contradiga a esto, manda esto.

> **01/10/2026 — Managed Payments** (`TRAINER_BILLING_TAX_POLICY=managed_payments`). Stripe vende como comerciante registrado, a través de Link: calcula, cobra, declara y paga el IVA y emite la factura. Cobra un 3,5 % más por transacción. Motivo: todavía no hay alta fiscal; detalle en la guía, A0.
> - **Checkout:** `managed_payments: { enabled: true }`, sin `automatic_tax`, `tax_id_collection`, `customer_update`, `payment_method_configuration` ni `custom_text` (Stripe rechaza `custom_text`). `consent_collection` sigue funcionando si la URL de condiciones está también en los datos públicos de la cuenta.
> - **Precios:** `exclusive` también aquí (IVA aparte). Previsualizaciones y renovación salen con el IVA de Stripe sin pasar `automatic_tax`.
> - **Calendarios:** las suscripciones de Managed Payments tienen `issuer` y `liability` = `stripe`. `copyPhase` no los reenvía (la API solo admite `self`/`account`) y la fase los hereda de `default_settings`.
> - **Live:** no exige configuración de métodos de pago. El preflight avisa de que el estado de Managed Payments se mira en el Dashboard.
> - **Verificación:** `.stripe-local/claude/verify-managed.cjs`, 12/12 en el sandbox.

> **28/09/2026 — política de dinero y operativa.** Guía para el negocio y la puesta en producción: [`docs/stripe-trainers-guia.md`](../../docs/stripe-trainers-guia.md).
> - **Reembolsos:** ya no cancelan nada por sí solos (sustituye a la regla del 21/09). Cada cargo reembolsado abre un caso en `trainerbillingcases` con qué financiaba el pago (`financing.ts`: periodo, subida, mensual → anual o desconocido), el estado de cada reembolso (incluido el fallido) y el efecto sugerido. El efecto lo decide una persona en Gestión.
> - **Disputas:** al abrirse se pausan los cobros (`pause_collection: keep_as_draft`) y los reintentos de las facturas abiertas; el acceso se mantiene y los cambios de plan se bloquean (`COLLECTION_PAUSED`). Si se pierde, se retira solo lo que financiaba el pago: el periodo vigente (ajuste `revoke_period`) o la subida (precio anterior sin prorrateo). Un periodo antiguo o desconocido nunca toca el acceso de hoy. Al cerrarse, el caso pide decidir si se reanudan los cobros. Los avisos de fraude temprano abren un caso.
> - **Eventos nuevos (31 en total):** `charge.refund.updated`, `refund.created|updated|failed`, `charge.dispute.updated|closed|funds_withdrawn|funds_reinstated` y `radar.early_fraud_warning.created|updated`. Cada objeto se relee de Stripe. Además, cada 10 minutos se recuperan con `events.list` los eventos de dinero de las últimas 72 h, por si un webhook se perdió.
> - **Gestión (auth `admin`):** `GET /admin/trainers/cases`, `GET /admin/trainers/lookup?email=`, `GET /admin/trainers/:userId` y `POST /admin/trainers/:userId/interventions`. Acciones: `resolve_case`, `end_service_now`, `cancel_renewal`, `resume_renewal`, `revert_upgrade`, `grant_access`, `end_grant`, `restore_period_access`, `pause_collection`, `resume_collection`. Cada intervención queda en `trainerbillinginterventions` con motivo obligatorio, autor, estado antes y después, y resultado.
> - **Acceso efectivo** (`effectiveAccess`): lo pagado según Stripe, menos los periodos retirados, más las excepciones hasta una fecha. Nunca se finge un cobro.
> - **Checkout:** `payment_method_configuration` (tarjeta, Apple Pay, Google Pay y Link), aceptación de condiciones (`consent_collection`, guardada en la cuenta) y texto de renovación y cancelación. En live son obligatorios `STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID`, `TRAINER_BILLING_TERMS_URL` y `TRAINER_BILLING_SUPPORT_EMAIL`.
> - **Aviso de renovación anual** a 30 y 7 días: por email (Resend, sin duplicados: se marca antes de enviar) desde el ciclo de reconciliación existente, sin cron nuevo, y en la app (`billing.renewalNotice`).
> - **Hecho también:**
>   - `billing.review` ya no se envía al entrenador;
>   - en la app se muestran Link, las carteras y los importes reembolsados;
>   - `CORS_EXTRA_ORIGINS` existe de verdad (`components/util/cors-origin.js`);
>   - el test del webhook está arreglado y los tests de pagos entran en `npm test`;
>   - el preflight revisa permisos, métodos de pago, portal completo, webhook y registro de IVA de España.
> - Lo que sigue por debajo de este bloque es historia (21/09 y 18/09). Donde contradiga lo anterior, manda lo anterior.

> **21/09/2026 — modo real implementado (desactivado por defecto).**
> - `TRAINER_BILLING_MODE=live` exige `rk_live_`, `TRAINER_BILLING_TAX_POLICY=stripe_tax` y `TRAINER_BILLING_FRONTEND_URL` en `https://` fuera de localhost. El modo `test` sigue exigiendo clave de prueba, frontend local y la BD `trainfit_stripe_local`, y no funciona con `NODE_ENV=production`.
> - `assertMode` rechaza objetos de Stripe del otro entorno; cuentas y eventos se separan por `mode`.
> - Stripe Tax: precios `exclusive` validados, Checkout con `automatic_tax` + dirección + NIF, e IVA desglosado en `quote.taxAmount`.
> - Eventos nuevos:
>   - `charge.refunded`: un reembolso total del cobro vigente cancela en el acto; cualquier otro caso marca `review`.
>   - `charge.dispute.created`: marca `review`; el cliente se resuelve por el PaymentIntent.
> - La reconciliación omite cuentas terminadas.
> - `npm run billing:preflight` valida en el servidor configuración, precios, portal y Stripe Tax sin imprimir secretos.
> - Guía de salida: `docs/TRAINERS_PAGOS_PRODUCCION.md`. Lo que sigue documenta el sandbox local.

## Entorno local y sandbox

Un solo `.env` (plantilla en `.env.example`). Cinco variables:

| Variable | Qué es |
| --- | --- |
| `STRIPE_KEY` | Sin ella la facturación está apagada (todos en Free). `rk_test_` / `sk_test_` = sandbox (local y PRE); `rk_live_` = real (solo PRO, solo restringida). |
| `STRIPE_WEBHOOK_SECRET` | Secreto del destino de webhook, o el que imprime `stripe listen` en local. |
| `STRIPE_RETURN_URL` | Web de Trainers (vuelta de Checkout y del portal). |
| `STRIPE_TERMS_URL`, `STRIPE_SUPPORT_EMAIL` | Condiciones y buzón de facturación; obligatorios en real. |

Pasos:

1. `npm run stripe:catalog:dry-run` y `npm run stripe:catalog`: crea en la cuenta de la clave los productos (Inicio, Profesional, Escala y «Plaza adicional», código fiscal SaaS para Managed Payments) y los precios con su lookup key y metadatos `trainfit_*`. Si la clave restringida no puede escribir precios, `STRIPE_CATALOG_KEY` con una que pueda. Los precios del catálogo anterior (Pro, Growth, Scale) se archivan a mano.
2. `stripe listen --forward-to http://localhost:3000/api/billing/webhooks/stripe` y su `whsec_…` en `STRIPE_WEBHOOK_SECRET`.
3. Portal: la configuración **predeterminada** de la cuenta, con facturas, método de pago y cancelación a fin de periodo, y sin cambios de plan (el backend lo comprueba).
4. `npm run billing:preflight` comprueba configuración, precios, portal y webhook sin imprimir secretos.
5. `npm run migrate:trainer-seats:dry-run` y `npm run migrate:trainer-seats` (una vez por base): borra las proyecciones de RevenueCat de entrenadores y convierte las de Stripe al modelo de plazas.

Sandbox y real conviven en la misma base sin mezclarse: cuentas, eventos y casos van por `mode`, y el cupo solo acepta proyecciones del modo de la clave del servidor. Ya no hay lanzador `stripe:local` ni base de datos aislada.

## API autenticada

Todas las rutas salvo webhook requieren `auth(["trainer"])`. No se acepta customerId, importe ni Price ID del navegador.

| Método y ruta bajo `/api/billing` | Entrada | Resultado |
|---|---|---|
| GET `/trainer/plans` | — | catálogo: planes con plazas incluidas y máximas, cuota y precio de plaza por periodicidad |
| POST `/trainer/checkout` | `{tier,interval,extraSeats}` | `{url,sessionId,reused}` |
| POST `/trainer/portal` | `{}` | `{url}` |
| GET `/trainer/billing-details` | — | `{invoices, paymentMethod}` leídos de Stripe |
| POST `/trainer/change-preview` | `{tier,interval,extraSeats}` | Propuesta con `kind` (immediate, scheduled), importes, `readOnlyAfter` y renovación |
| POST `/trainer/change-plan` | `{quoteId}` | `status`, posible `paymentActionUrl` y `entitlements` |
| POST `/trainer/cancel` · `/resume` · `/discard-change` · `/sync` | `{}` / `{sessionId?}` | entitlements |
| GET `/trainer/entitlements/me` | — | plan, `seats` (capacidad, ocupadas, reservadas, libres, admisión) y estado de la facturación |
| POST `/webhooks/stripe` | Bytes originales + Stripe-Signature | `{received:true}` |

Planes `free`, `starter`, `professional`, `scale`; catálogo en `src/catalog.ts`. Una suscripción tiene una cuota (salvo Free) y un elemento de plazas adicionales con cantidad; Free con plazas es una suscripción solo con ese elemento. Una plaza con cantidad 0 se conserva y no cuenta.

## Política de cambios y cancelación

| Operación | Cuándo se aplica | Facturación |
| --- | --- | --- |
| Subir de plan, misma periodicidad | Inmediata, tras confirmar el pago | Diferencia prorrateada del periodo |
| Bajar de plan, misma periodicidad | Próxima renovación | Se conserva el periodo ya pagado |
| Mensual → anual | Inmediata, tras confirmar el pago | Nuevo año menos el crédito del mes no consumido |
| Anual → mensual | Al vencer el año pagado | Primer mes al comenzar la nueva periodicidad |
| Cancelar | Al vencer el periodo pagado | Se desactiva la renovación; no hay devolución implícita |
| Reactivar | Antes del vencimiento | Se recupera la renovación |

Los cambios conjuntos de plan y periodicidad siguen la regla de periodicidad: anual → mensual siempre se programa (también si sube de plan; la UI ofrece entonces la misma subida en anual, que es inmediata).

Ampliación 18/09/2026 (Claude, tras la fase de Codex):

- **Sustituir un cambio programado**: elegir otro plan con un cambio programado propio ya no exige descartarlo antes. La propuesta nueva guarda el calendario como `previousScheduleId` y `recoverChange` lo libera antes de cobrar o programar la sustitución. Elegir el mismo destino devuelve `SAME_SCHEDULED_CHANGE`; elegir la modalidad actual equivale a descartar (lo hace la UI).
- **Renovación con calendario adjunto**: con un schedule adjunto Stripe previsualiza su fase siguiente e ignora `subscription_details.items` (comprobado en sandbox: devolvía el precio programado antiguo). En ese caso la renovación estimada es la tarifa del destino.
- **Próxima renovación real** (`billing.renewal`): `invoices.createPreview({subscription})` en cada `refresh`, cacheado por huella de la suscripción; incluye descuentos, saldo a favor y la fase programada. Un fallo de esta consulta nunca bloquea el webhook.
- **Renovación impagada** (`billing.renewalPayment`): con `past_due`/`unpaid` y factura de renovación abierta se expone su enlace alojado de Stripe e importe. **Margen de 7 días** (decisión de negocio): el acceso pagado se mantiene hasta `paidUntil + 7 días` mientras Stripe reintenta.
- **Facturas y método de pago** (21/09/2026): `GET /api/billing/trainer/billing-details` devuelve las 12 últimas facturas no borrador del propio customer (enlaces solo a `invoice.stripe.com` / `pay.stripe.com`) y la tarjeta por defecto (marca, últimos 4, caducidad). Solo lectura; si la clave no puede leer el método se omite.
- **Desglose de la propuesta** (`quote.lines`): líneas de prorrateo de la preview de Stripe (crédito del plan actual, cargo del nuevo) con plan, importe y periodo; las etiquetas son nuestras porque las descripciones de Stripe vienen en inglés. Suman exactamente `amountDueNow` (comprobado en sandbox).
- **Mensual → anual**: el año queda alineado al día de cobro original (Stripe no reinicia el ancla con `proration_date`), así que el primer cargo anual es un año prorrateado; la propuesta y la factura coinciden.
- **Exceso de clientes al volver a Free** (decisión de negocio): el entrenador elige qué clientes siguen activos (`GET/PUT /api/trainer/seats`, `components/trainerClients/trainer-seat-service.js`); el resto queda en solo lectura (GET permitido, escrituras 403 `CLIENT_READ_ONLY` en `requireActiveClient`, `canAccessUserTable` y las altas por lote). La elección se puede cambiar una vez cada 30 días; la primera es libre; mientras no elige, siguen activos los más antiguos. Nada se borra. Se comprueba el cupo del destino antes de aceptarlo. Si hay más clientes que los admitidos, el entrenador debe reducirlos antes; nunca se archivan automáticamente.

Angular muestra una propuesta calculada por el backend y Stripe, con importe, fecha, posible crédito y renovación estimada. La propuesta dura cinco minutos. Al confirmar, el navegador solo envía su identificador opaco. El backend comprueba propietario, estado, cupo y vigencia; conserva una operación persistente y utiliza claves de idempotencia para que un reintento no duplique el cobro.

Las subidas utilizan `pending_if_incomplete` y `always_invoice`. Si hay un pago pendiente o autenticación adicional, se conserva el acceso ya pagado y se ofrece completar el pago. Las bajadas utilizan un calendario de Stripe con dos fases. El portal mantiene deshabilitados sus cambios de plan; facturas y métodos de pago siguen disponibles allí. Cancelar o reactivar desde Trainers no depende de abrir el portal.

Una bajada programada limita también nuevas invitaciones al cupo futuro. La comprobación y las altas se ejecutan bajo el mismo bloqueo persistente por entrenador que los cambios de suscripción. Las relaciones existentes y el acceso pagado se conservan.

## Consistencia y acceso

- Colecciones propias `trainerbillingaccounts` y `trainerbillingevents`. Un customer por usuario/modo; índice único y lease persistente por usuario; claves de idempotencia guardadas antes de las llamadas externas.
- Un evento queda procesado solo después de guardar estado y proyección. Fallos conservan trabajo reintentable. Una reconciliación cada 15 minutos reintenta eventos y reconcilia hasta 100 cuentas por ronda, empezando por las más antiguas.
- Se consulta el estado actual de Stripe dentro del lease; no se aplican ciegamente payloads antiguos. Revisión incremental en User impide que una proyección anterior sobrescriba otra nueva.
- Solo una factura pagada correspondiente al precio y periodo concede/amplía acceso. Pago inicial incompleto no lo concede. Una actualización pendiente no concede el tier nuevo; conserva el periodo/tier ya pagado. Caducidad local limita el acceso aunque se pierda un webhook.
- `professionalPremium.source` permanece stripe tras expirar/cancelar. RC no puede sobrescribirlo; `premium` consumidor es independiente. Restaurar RC profesional usa únicamente identidad autenticada y consulta del servidor.
- Borrado explícito marca una tumba persistente, caduca checkouts abiertos y cancela suscripciones antes de eliminar al usuario. Si falla, la cuenta se conserva para reintentar. Los hooks impiden saltarse ese flujo mediante borrados Mongoose directos. No hay reembolso implícito.

Registrar los 31 eventos de `SUPPORTED_EVENT_TYPES` (`src/stripe-gateway.ts`; lista agrupada en la guía, paso A7): los 19 de suscripciones, checkout, calendarios y facturas, más los 12 de dinero (`MONEY_EVENT_TYPES`: reembolsos, disputas y avisos de fraude). El webhook queda antes del parser JSON y del bloqueo de mantenimiento.

## Límites explícitos de esta fase

- LIVE, Stripe Tax y registros fiscales no están configurados. No basta cambiar una variable para vender en producción: requiere una siguiente fase con decisión fiscal, dominio HTTPS, credenciales live y verificación real.
- Los cambios en autoservicio se implementan para una suscripción con un artículo y el catálogo permitido. Estados o configuraciones avanzadas no admitidos requieren revisión; no se modifican de forma aproximada. Sin pruebas gratuitas configuradas; cupones pueden introducirse si se crean en Stripe.
- Reembolso y cancelación son operaciones distintas. Un reembolso aislado no retira automáticamente acceso ni cancela renovaciones: abre un caso y decide una persona (28/09/2026; ver la cabecera).
- El cupo deduplica scopes y contempla los cuatro estados de onboarding. Las invitaciones de cuentas Stripe se serializan por entrenador para evitar excederlo con altas simultáneas. No archiva clientes existentes al cancelar; queda por definir el tratamiento de las relaciones que excedan Free antes de producción.
- Una respuesta de creación de customer incierta durante más de 23 h, o Checkout incierto durante más de 25 min, se bloquea para revisión. No se crea otro cobro por adivinar que el anterior falló. Cuentas con más de 100 sesiones históricas también requieren revisión antes de más altas (límite conservador de esta versión).
- Las pruebas unitarias del core/gateway usan dobles en memoria, sin Stripe ni correo. Las pruebas reales de sandbox y su alcance se registran en `docs/TRAINERS_STRIPE_SANDBOX.md` del workspace. No constituyen un despliegue de producción.

## Pruebas y entrega del artefacto

`npm run test:trainer-billing` compila y prueba core, adaptadores y regresión de acceso. `npm test` incluye los tests nuevos junto a los existentes.

Para cualquier futura distribución: ejecutar el build con devDependencies disponibles, distribuir `.build/trainer-billing` junto al JS y después reducir dependencias de runtime si procede. `.build` está ignorado en Git. `prestart`/`preserve` recompilan en desarrollo; un entorno sin TypeScript instalado debe construir antes y arrancar el artefacto mediante `node bin/www`. No se han modificado pipelines de despliegue.

Documentación oficial consultada 18/09/2026: [SDK y API fijada](https://github.com/stripe/stripe-node/blob/v22.6.2/src/apiVersion.ts), [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions/create), [webhooks de suscripciones](https://docs.stripe.com/billing/subscriptions/webhooks), [firma de webhooks](https://docs.stripe.com/webhooks#verify-events), [claves restringidas](https://docs.stripe.com/keys/restricted-api-keys).
