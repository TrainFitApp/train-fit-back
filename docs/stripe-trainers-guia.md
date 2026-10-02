# Stripe en TrainFit Trainers — guía definitiva

Actualizada: 01/10/2026 (Managed Payments). Alcance: la suscripción que los entrenadores pagan a TrainFit (Pro, Growth y Scale). No trata los cobros que los clientes pagan a sus entrenadores (`trainerPayments`), que son otra cosa.

Esta guía sustituye a `docs/TRAINERS_PAGOS_COMO_FUNCIONA.md`, `docs/TRAINERS_PAGOS_PRODUCCION.md` y `docs/TRAINERS_STRIPE_SANDBOX.md` de la carpeta raíz, que no están versionados. La referencia técnica está en [`components/trainerBilling/README.md`](../components/trainerBilling/README.md).

## Estado en una tabla

| Pieza | Estado |
| --- | --- |
| Código de suscripciones (alta, cambios, renovación, impago, cancelación) | Terminado y verificado en el sandbox (18, 21 y 28/09/2026) |
| Reembolsos, disputas, avisos de fraude e intervenciones (política del 28/09/2026) | Terminado; verificado en el sandbox el 28/09/2026 (ver la sección 6) |
| Configuración del sandbox de Stripe | Incompleta: faltan el portal con edición de datos fiscales y los enlaces legales (paso A5) |
| Cuenta real (live) de Stripe | Configurada por el usuario y revisada el 01/10/2026 (catálogo, métodos de pago, portal, webhook, correos y disputas). Faltan los datos públicos legales (parte C) |
| Managed Payments (Stripe vende e ingresa el IVA) | Activado en el sandbox y en live el 01/10/2026; verificado de punta a punta en el sandbox (sección A0) |
| Producción | **No preparada.** Bloqueos en la parte C |

## Decisiones de negocio en vigor (28/09/2026)

1. **Reembolsos.** Cancelar la renovación no devuelve el periodo contratado.
   - Excepciones: cobro duplicado o incorrecto, cobro posterior a una cancelación efectiva, incumplimiento relevante del servicio y devoluciones legalmente obligatorias.
   - Renovación anual no deseada: 7 días naturales para pedir la devolución, como concesión comercial y sin limitar los derechos legales.
   - Los aprueba el responsable de facturación, que deja registrados el motivo, el importe, el autor y el efecto sobre la suscripción.
   - El desistimiento lo valida la asesoría.
2. **Acceso tras un reembolso total.** Depende de qué se devuelve y por qué:
   - Se devuelve el pago del periodo actual para terminar el servicio: se retira el acceso de pago y se conservan los datos.
   - Duplicado o compensación: se puede mantener el acceso.
   - También se puede conceder acceso hasta una fecha. Queda registrado y no finge un cobro.
3. **Reembolso de una subida de plan.**
   - Si se devuelve entero el incremento: vuelta al plan anterior, respetando el periodo base ya pagado. Los clientes que excedan el cupo pasan a solo lectura.
   - Un reembolso parcial por compensación puede mantener el plan superior.
   - Si no se puede saber qué financiaba el cargo: revisión manual antes de retirar acceso.
4. **Durante una disputa.**
   - Se mantiene el acceso provisionalmente y se abre una revisión prioritaria, a atender en un día laborable.
   - Se desactivan los cobros futuros de esa suscripción, también los reintentos, sin borrar datos ni retirar el periodo vigente.
   - El fraude confirmado permite una suspensión específica.
   - Una disputa de una factura antigua no invalida periodos posteriores pagados.
5. **Disputa perdida.**
   - Se retiran solo los derechos que dependían del pago perdido.
   - No hay bloqueo de por vida. Las restricciones de contratación se reservan para fraude o abuso documentado, con revisión humana.
   - No se contesta ni se acepta todo por sistema: se valoran el importe, las comisiones y el trabajo.
   - Smart Disputes, al principio supervisado.
6. **Métodos de pago en live.**
   - Al empezar: tarjeta, Apple Pay, Google Pay y Link, mediante una configuración de métodos de pago de Stripe.
   - SEPA, en una segunda fase: antes hay que probar mandatos, cobros pendientes y devoluciones (8 semanas sin justificación).
7. **Fiscalidad.** IVA aparte. De momento, una cuenta de entrenador no puede tener cuenta de cliente.
   - **01/10/2026: Managed Payments.** Stripe vende como comerciante registrado, a través de Link, y calcula, cobra, declara y paga el IVA. Motivo: todavía no hay alta fiscal.
   - Cuesta un 3,5 % adicional por cada transacción. Detalle en A0.
   - No resuelve el IRPF ni el alta en Hacienda por los ingresos que paga Stripe: eso lo decide la gestoría.
   - Stripe Tax (`TRAINER_BILLING_TAX_POLICY=stripe_tax`) queda como alternativa para cuando haya NIF con IVA. Esa opción exige el registro de España (A4).
8. **Soporte de facturación.** `facturacion@trainfit.net` (propuesto: hay que crearlo y comprobarlo). Primera respuesta humana en un día laborable; los cobros erróneos y los bloqueos de acceso tienen prioridad.
9. **Dominios.**
   - Web de Trainers: `trainers.trainfit.net` (propuesto, pendiente de configurar).
   - API: la build de producción usa `https://server.trainfit.net/api`. Eso lo dice el código; no acredita que el despliegue esté hecho.
10. **Descriptor y aviso anual.**
    - Descriptor propuesto: `TRAINFIT`, si Stripe lo admite.
    - Aviso de la renovación anual 30 y 7 días antes, por email y dentro de Trainers, con la fecha, el importe previsto y cómo cancelar.
11. **Responsables.** Ambos: Davvidar y sangovis98.

Decisiones anteriores que siguen vigentes:
- Precios sin IVA (IVA aparte).
- Sin pruebas gratuitas.
- Subir en la misma periodicidad: inmediato con prorrateo. Bajar: al renovar. Mensual → anual: inmediato. Anual → mensual: al vencer el año.
- Cancelar surte efecto al final del periodo.
- Impago: 7 días de margen.
- Si se vuelve a Free con más de 3 clientes: se eligen 3 activos y el resto queda en solo lectura, cambiable cada 30 días.

---

## A. Qué debes hacer tú en Stripe, paso a paso

Hay dos entornos que no se mezclan nunca:
- **Sandbox** «Entorno de prueba de TrainFit» (`acct_1UGObgAkRj4BmEBX`): para probar, sin dinero real.
- **Cuenta real (live)**: para cobrar. La documentación anterior la identificaba como `acct_1UGObMAteZGzMQWA`; confírmalo en el Dashboard.

Todo lo que configures en uno hay que repetirlo en el otro. Los identificadores (`price_…`, `bpc_…`, `pmc_…`, `whsec_…`) son distintos en cada entorno.

Las rutas del Dashboard pueden cambiar de nombre. Si no encuentras una opción, busca la ruta indicada (`dashboard.stripe.com/…`).

### A0. Managed Payments (Stripe como vendedor), decisión del 01/10/2026

- **Dónde:** Configuración → Managed Payments (`dashboard.stripe.com/settings/managed-payments`).
- **Hecho el 01/10/2026 en el sandbox y en live.** Asistente completado y estado «Listo para usar»; pasa a «Activo» con la primera venta. Los 3 productos «cumplen los requisitos» como «SaaS - business use».
- **Solicitudes de reembolso:** «Quiero recibir un correo electrónico para que lo apruebe». Hay 48 h para aceptar o rechazar cada una, en línea con la decisión 1.
- **No actives «Habilitar de manera predeterminada».** El backend lo activa sesión a sesión.
- **Qué cambia respecto al resto de la parte A:**
  - **A3:** la configuración de métodos de pago no se usa. Managed Payments elige los métodos (tarjeta, Apple Pay, Google Pay y Link, entre otros).
  - **A4:** no hace falta el registro de IVA propio en Stripe Tax. La factura la emite Link («Vendido a través de Link»), con el nombre de TrainFit.
  - **A5:** el Checkout es el estándar de Stripe, sin textos propios: Stripe rechaza `custom_text`. Ya muestra las condiciones de Link y la autorización de cobro recurrente hasta cancelar. La app enseña antes la nota de renovación y la de «vendido por Link». La aceptación de las condiciones de TrainFit sigue funcionando si su URL está en los datos públicos.
  - **A6:** los recibos y las facturas de estas ventas los envía Link. El aviso anual de TrainFit (30 y 7 días antes) sigue saliendo igual.
  - **A9:** Stripe gestiona las disputas de estas ventas y presenta las pruebas. TrainFit sigue abriendo el caso y pausando los cobros según la decisión 4. Stripe puede reembolsar por su cuenta en los 60 días siguientes a la compra para evitar contracargos, y aplica el desistimiento de los consumidores de la UE.
- **Código:**
  - `TRAINER_BILLING_TAX_POLICY=managed_payments`.
  - El Checkout envía `managed_payments.enabled` y no envía `automatic_tax`, `tax_id_collection`, `customer_update`, `payment_method_configuration` ni `custom_text`.
  - Las bajadas programadas dejan que el calendario herede el emisor y el impuesto de Stripe.
- **Verificado en el sandbox (01/10/2026)** con `node .stripe-local/claude/verify-managed.cjs start|finish|resume|clean`: 12/12 comprobaciones.
  - Alta: 29,00 € + 21 % = 35,09 €.
  - Factura con el IVA y renovación prevista con el IVA.
  - Subida con prorrateo: 24,20 €, de los que 4,20 € son IVA.
  - Bajada programada (y recuperación de un intento a medias), descartar el cambio, portal, cancelar y reactivar.
  - Reembolso → caso con «revertir subida».

### A1. Cuenta y datos del negocio (solo live)

- **Dónde:** Dashboard live → Configuración → Datos de la empresa, y el aviso de «Activar pagos» si aparece.
- **Qué:** forma jurídica, NIF, domicilio, representante, identidad y **cuenta bancaria** para las transferencias. Los datos salen de la empresa y de la asesoría; ninguno está en el repositorio.
- **Comprobación:** no quedan requisitos pendientes y los cobros y las transferencias figuran como activos.
  - `npm run billing:preflight` también lo comprueba si la clave puede leer la cuenta. Si no puede, muestra un aviso (!) y lo miras a mano.

### A2. Productos, precios y periodicidades (sandbox: hechos; live: pendientes)

- **Dónde:** Catálogo de productos.
- **Qué:** 3 productos con el código fiscal `txcd_10103001` (SaaS de uso empresarial). Cada uno lleva 2 precios **recurrentes en EUR, con el impuesto no incluido («exclusive»)**:

  | Producto | Mensual | Anual |
  | --- | ---: | ---: |
  | TrainFit Trainers Pro (20 clientes) | 29,00 € | 297,00 € |
  | TrainFit Trainers Growth (50 clientes) | 49,00 € | 509,00 € |
  | TrainFit Trainers Scale (150 clientes) | 119,00 € | 1.209,00 € |

- **Origen de los valores:** catálogo confirmado (`components/trainerBilling/src/config.ts`).
- **Después:** apunta los 6 identificadores `price_…` en las variables `STRIPE_TRAINER_{PRO|GROWTH|SCALE}_{MONTHLY|ANNUAL}_PRICE_ID`.
- **Comprobación:** el preflight da ✔ en los 6 precios. El backend rechaza cualquier precio con otro importe, moneda, intervalo, modo o tratamiento del IVA.
- **Sandbox (comprobado el 28/09/2026):** los 6 precios existen, son `exclusive` y llevan `txcd_10103001`.

### A3. Métodos de pago

- **Dónde:** Configuración → Pagos → Métodos de pago (`dashboard.stripe.com/settings/payment_methods`).
- **Qué:** crea una configuración propia de métodos de pago llamada, por ejemplo, «TrainFit Trainers».
  - **Activados:** tarjeta, Apple Pay, Google Pay y Link.
  - **Desactivado:** todo lo demás, SEPA incluido (fase 2). El sandbox tiene hoy activados además Klarna, Amazon Pay, Bancontact, BLIK y otros en su configuración predeterminada.
- **Después:** apunta su identificador `pmc_…` en `STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID`. Checkout la usa en cada pago y el portal debe usar la misma (A5).
- **Comprobación:** el preflight da ✔ en «Métodos de pago» y lista los activos.
  - Necesita permiso de lectura de configuraciones de métodos de pago. La clave del sandbox **no lo tiene** hoy: da aviso (!).
  - En live es obligatorio (✘ si falta).

### A4. Impuestos, facturas y asesoría

1. **Stripe Tax** (Configuración → Impuestos):
   - domicilio fiscal real (el sandbox tiene uno ficticio, «Calle de Alcalá 1»);
   - comportamiento por defecto «exclusivo»;
   - registro de IVA de **España**;
   - OSS si se vende a particulares de otros países de la UE por encima del umbral: **lo decide la asesoría**.
   - Comprobación: el preflight da ✔ en «Stripe Tax» (activo, con registro ES).
2. **Datos del emisor en la factura** (Configuración → Facturación → Facturas, `dashboard.stripe.com/settings/billing/invoice`):
   - razón social y NIF de TrainFit;
   - prefijo de numeración;
   - pie legal que indique la asesoría.
   - Hoy las facturas del sandbox salen **sin el NIF de TrainFit** (`account_tax_ids: null`).
   - Comprobación: descarga el PDF de una factura de prueba.
3. **Rectificaciones:** los reembolsos se hacen desde la factura con una **nota de crédito**, que reduce la factura y reembolsa a la tarjeta. La asesoría debe confirmar que la nota de crédito de Stripe vale como factura rectificativa (numeración y contenido).
4. **Pendiente de asesoría (no lo decide el código):**
   - tipos aplicables;
   - OSS;
   - contenido obligatorio de la factura y de la rectificativa;
   - derecho de desistimiento;
   - redacción de las condiciones de contratación.

### A5. Checkout, portal de clientes y datos públicos

1. **Datos públicos** (Configuración → Datos públicos, `dashboard.stripe.com/settings/public`):
   - nombre visible;
   - web;
   - **email de soporte** `facturacion@trainfit.net` (cuando exista);
   - **URL de las condiciones de contratación** y **URL de privacidad**.
   - Checkout exige que la URL de condiciones esté aquí para pedir su aceptación. La misma URL va en `TRAINER_BILLING_TERMS_URL`.
2. **Ajustes de Checkout** (`dashboard.stripe.com/settings/checkout`): activa mostrar el contacto de soporte y las políticas legales. No actives la devolución automática.
3. **Portal de clientes** (Configuración → Facturación → Portal de clientes, `dashboard.stripe.com/settings/billing/portal`):
   - **Activado:**
     - historial de facturas;
     - actualizar método de pago, con la configuración `pmc_…` de A3;
     - actualizar nombre, dirección y NIF (en el sandbox está **desactivado** hoy);
     - cancelar la suscripción **al final del periodo, sin prorrateo**.
   - **Desactivado:** cambiar de plan (TrainFit gestiona los cambios).
   - Enlaces a las condiciones y a la privacidad.
   - URL de vuelta: `https://<dominio de Trainers>/tabs/subscription`.
   - Apunta el `bpc_…` en `STRIPE_TRAINER_PORTAL_CONFIGURATION_ID`.
   - Comprobación: el preflight da ✔ en «Portal de clientes». Si falta algo, lista lo que falta.

### A6. Emails, recordatorios, descriptor y soporte

1. **Descriptor del extracto** (Configuración de la cuenta / datos públicos):
   - `TRAINFIT`, si Stripe lo admite y coincide con la marca que ve el comprador;
   - entre 5 y 22 caracteres y al menos 5 letras.
   - Comprobación: aparece en el cargo de la prueba real (C7).
2. **Correos de Stripe:**
   - **Clientes** (Configuración → Correos a clientes): recibos de pagos correctos y de reembolsos.
   - **Suscripciones y correos** (`dashboard.stripe.com/settings/billing/automatic`):
     - enviar las facturas finalizadas;
     - enviar el enlace para confirmar pagos que requieren autenticación (3DS).
   - **Recuperación de ingresos** (`dashboard.stripe.com/revenue_recovery/emails`):
     - correo cuando falla un cobro con tarjeta;
     - correo de tarjeta a punto de caducar.
     - En «Actualizaciones de los métodos de pago», elige **«Enlace a una página alojada por Stripe»**. La opción heredada mandaba a `trainfit.net`, la web de clientes, donde un entrenador no puede cambiar la tarjeta. Stripe avisa de que el cambio no se puede revertir.
     - Live (01/10/2026): hecho.
3. **Recordatorio de renovación:**
   - Deja **desactivado** «Enviar correos sobre próximas renovaciones» de Stripe. TrainFit ya envía el aviso anual a 30 y 7 días, por email (SES) y en la app. Stripe solo admite un plazo global para todas las suscripciones y lo mandaría también a las mensuales: habría duplicados.
   - Si decidís usarlo en lugar del de TrainFit, avisad para desactivar el nuestro.
4. **Reintentos de pago** (misma página de suscripciones):
   - reintentos inteligentes con el plazo recomendado por Stripe (del orden de 2 semanas);
   - cuando se agoten: **cancelar la suscripción**.
   - TrainFit mantiene el plan pagado 7 días más y después pasa a Free, aunque Stripe siga reintentando. Si el cobro entra más tarde, el acceso vuelve solo.
5. **Soporte:**
   - crea y prueba `facturacion@trainfit.net`;
   - ponlo en los datos públicos (paso 1) y en `TRAINER_BILLING_SUPPORT_EMAIL`;
   - la app lo muestra en la página de suscripción y los avisos por email responden a esa dirección.

### A7. Webhooks, credenciales y permisos

1. **Clave restringida** (Desarrolladores → Claves API → Crear clave restringida). Nombre: «TrainFit Trainers producción» (en el sandbox, «… local»). Debe empezar por `rk_live_` (o `rk_test_`): el backend rechaza las claves secretas completas.

   | Permiso | Para qué |
   | --- | --- |
   | Customers: escritura | Crear y reutilizar el cliente de facturación |
   | Checkout Sessions: escritura | Abrir, consultar y caducar pagos |
   | Subscriptions (y calendarios): escritura | Cambios, cancelaciones, pausar y reanudar cobros, revertir subidas |
   | Invoices: escritura | Anular un cambio impagado, pausar reintentos y leer pagos de factura |
   | Customer portal: escritura | Abrir el portal y leer su configuración |
   | Prices: lectura | Validar el catálogo |
   | Charges, Refunds, Disputes y Radar (avisos de fraude): lectura | Saber qué financiaba cada reembolso o disputa |
   | Events: lectura | Recuperar eventos perdidos |
   | PaymentMethods: lectura | Mostrar la tarjeta, la cartera o Link |
   | Payment method configurations, Webhook endpoints y Tax: lectura | Preflight |

   - **No concedas:** reembolsos, disputas ni pagos en escritura. Esas operaciones se hacen en el Dashboard.
   - Guarda la clave en un gestor de contraseñas y en el entorno del servidor. **Nunca** en el repositorio, en el chat ni en la app de Gestión si no es imprescindible.
   - Comprobación: el preflight da ✔ en «Permisos de lectura».
   - La clave del sandbox puede hoy leer todo lo anterior salvo las configuraciones de métodos de pago.
2. **Webhook** (Desarrolladores → Webhooks → Añadir destino):
   - URL: `https://<dominio de la API>/api/billing/webhooks/stripe`. En el repositorio, la API de producción es `server.trainfit.net`.
   - Versión de API: `2026-08-26.dahlia`, la del SDK.
   - Eventos (31), la lista exacta de `SUPPORTED_EVENT_TYPES` en `components/trainerBilling/src/stripe-gateway.ts`:
     - **Checkout:** `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`.
     - **Suscripciones:** `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, `.pending_update_applied`, `.pending_update_expired`.
     - **Calendarios:** `subscription_schedule.updated`, `.released`, `.completed`, `.canceled`.
     - **Facturas:** `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`, `invoice.finalization_failed`.
     - **Reembolsos:** `charge.refunded`, `charge.refund.updated`, `refund.created`, `refund.updated`, `refund.failed`.
     - **Disputas:** `charge.dispute.created`, `.updated`, `.closed`, `.funds_withdrawn`, `.funds_reinstated`.
     - **Fraude:** `radar.early_fraud_warning.created`, `radar.early_fraud_warning.updated`.
   - Copia el secreto `whsec_…` en `STRIPE_WEBHOOK_SECRET`.
   - Comprobación: el preflight da ✔ en «Webhook» (un único destino activo, todos los eventos y la versión correcta).
   - En el sandbox **no hay destino registrado**: se usa `stripe listen`.

### A8. Usuarios del Dashboard y responsabilidades

- **Dónde:** Configuración → Equipo y seguridad.
- Cada responsable (Davvidar y sangovis98) tiene **su propio usuario** con verificación en dos pasos. Nadie comparte credenciales.
- Rol: el mínimo que permita reembolsar, gestionar disputas y ver pagos. Consulta la tabla de roles de Stripe al asignarlo. La propiedad y la cuenta bancaria, solo el titular.
- En TrainFit, ambos necesitan rol `admin` para la app de Gestión.
- Las intervenciones quedan firmadas con el usuario de Gestión; los reembolsos, con el usuario del Dashboard.

### A9. Reembolsos, disputas y prevención

- **Ajustes de disputas del Dashboard:**
  - En «Gestionar pagos disputados» (`dashboard.stripe.com/settings/billing/automatic`), **no actives** la cancelación automática por disputa. TrainFit pausa los cobros y conserva el acceso (decisión 4); si Stripe cancelara, lo contradiría.
  - **Smart Disputes** (Configuración → Disputas):
    - activarlo supervisado; revisa las pruebas que prepara antes de que se envíen, porque se envían solas antes del plazo si no haces nada;
    - según la tarifa pública española, cobra el 30 % del importe disputado **solo si ganas**; la comisión por recibir la disputa se cobra igual;
    - confirma las condiciones de tu cuenta.
  - **Prevención de disputas** (resolución automática, que reembolsa sola): no la actives sin fijar antes reglas y límites propios.
- **Radar** (reglas de fraude): deja las reglas por defecto al empezar. Si hay fraude real, añade reglas con criterio.
- **Prevención que ya hace TrainFit:**
  - texto de renovación y cancelación junto al botón de pago;
  - aceptación de las condiciones en Checkout, guardada con la sesión;
  - email de soporte visible;
  - cancelación en dos clics;
  - avisos antes de renovar un plan anual;
  - 3DS cuando lo pide el banco.

---

## B. Cómo funciona la integración

Resumen: TrainFit **solo da acceso a lo que Stripe confirma como pagado**. Nunca lo hace por volver de la página de pago ni por lo que diga el navegador. Todo lo que llega de Stripe se vuelve a leer de Stripe antes de actuar, así que los avisos duplicados, tardíos o desordenados dan el mismo resultado.

```
Entrenador (web de Trainers) ──► API TrainFit ──► Stripe Checkout / Billing / Tax
          ▲                          ▲   │                 │
          │ estado y avisos          │   └─ lee y actúa ◄──┘ webhooks firmados (31 eventos)
          │                          │
          └── users.professionalPremium (acceso) ◄── trainerbillingaccounts (estado, pausas, ajustes)
                                          trainerbillingevents (cada evento, una vez)
                                          trainerbillingcases (reembolsos, disputas, avisos de fraude)
                                          trainerbillinginterventions (decisiones de Gestión, con autor)
Cada minuto (solo con TRAINER_BILLING_ENABLED=1): reintenta eventos, relee suscripciones, envía los
avisos anuales y, cada 10 minutos, recupera de Stripe los eventos de dinero de las últimas 72 horas.
```

Ejemplos con Pro mensual: 29 € + IVA = **35,09 €** para un particular en España. Para una empresa de la UE con NIF-IVA válido, inversión del sujeto pasivo: **29,00 €**.

| Operación | Dinero | Suscripción en Stripe | Acceso del entrenador | Qué ve en la app | Intervención humana |
| --- | --- | --- | --- | --- | --- |
| **Contratar** (web, Checkout) | Se cobran 35,09 € con tarjeta, Apple/Google Pay o Link | Se crea y queda activa | Pro (20 clientes) hasta la fecha de renovación, en cuanto la factura consta pagada | «Tu suscripción está confirmada», plan Pro, próxima renovación | Ninguna |
| **Renovar** | Stripe cobra el mismo importe el día de renovación | Sigue activa | Se amplía un periodo | Próximo cobro con el importe real de Stripe (descuentos y saldo incluidos) | Ninguna. En los anuales, email y aviso en la app 30 y 7 días antes |
| **Subir** (Pro → Growth a mitad de mes) | Hoy, la diferencia prorrateada + IVA (p. ej. 12,10 €, el importe exacto de Stripe) | Cambia de precio al pagar | Growth desde hoy. Si el pago falla o pide 3DS, conserva Pro | Resumen antes de confirmar (qué se cobra, cuándo y el cupo); después, Growth | Ninguna |
| **Bajar** (Growth → Pro) | 0 € hoy; Pro en la renovación | Cambio programado | Growth hasta la renovación; las nuevas altas ya se limitan a 20 | «Cambio programado» | Ninguna |
| **Mensual → anual** | Hoy: año prorrateado menos el mes no usado | Cambia a anual | Anual desde hoy | Resumen con las líneas del cálculo | Ninguna |
| **Anual → mensual** | 0 € hoy | Programado al final del año | Anual hasta el final del año pagado | «Cambio programado» | Ninguna |
| **Cancelar** (app o portal) | Nada más; **no hay reembolso automático** | No se renovará | Hasta el final del periodo pagado; después Free (3 activos, resto en solo lectura, sin borrar nada) | «No se renovará», fecha de fin | Ninguna |
| **Reactivar** (antes del fin) | Nada | Vuelve a renovarse | Igual | «Activa» | Ninguna |
| **Falla un cobro de renovación** | Stripe reintenta durante días y avisa por email | `past_due` | Mantiene el plan **7 días**; después Free si no se cobra | «Pago pendiente» con **Pagar ahora** y fin del margen | Ninguna. Mirar los impagos cada semana |
| **Recuperar un impago** | El entrenador paga la factura o cambia la tarjeta en el portal y Stripe cobra | Vuelve a activa | Recupera el plan en cuanto consta el pago | «Activa» | Ninguna |
| **Reembolsar** (siempre en Stripe) | Vuelve a la tarjeta. Mejor desde la factura con nota de crédito | **No cambia sola** | **No cambia solo**: abre un caso en Gestión con qué financiaba ese pago | La factura muestra «Reembolsado X €» | **Sí**: decidir en Gestión el efecto (ver abajo) |
| **Disputa** (el banco retira el cargo) | El banco retira el importe y Stripe cobra su comisión. Mientras está abierta no se puede reembolsar | TrainFit **pausa los cobros** (facturas en borrador, sin reintentos) | **Se mantiene** | «Cobros en pausa… tu acceso se mantiene» y el email de facturación | **Sí**: responder en Stripe antes de la fecha límite y decidir en Gestión |
| **Disputa perdida** | El dinero se queda en el banco del cliente | La pausa sigue hasta que decidáis | Se retira **solo** lo que financiaba ese pago: el periodo vigente o la subida. Un periodo antiguo no toca el acceso de hoy | «Acceso retirado hasta …» si era el periodo vigente | Decidir si reanudar los cobros o cancelar |
| **Disputa ganada** | El dinero vuelve (la comisión por recibirla no) | Sigue en pausa | Igual | Igual | Decidir si reanudar los cobros |
| **Aviso de fraude del banco** | Nada todavía | Nada | Nada | Nada | Valorar reembolsar como fraude y terminar el servicio para evitar una disputa |

**Qué decide una persona tras un reembolso** (Gestión → Facturación Trainers → caso → «Usar este caso»):
- **Devolución anual en los 7 días, o baja por incumplimiento:** reembolso total en Stripe (nota de crédito) + **Terminar servicio ahora**. La suscripción se cancela sin prorrateo, el acceso de pago termina hoy y los datos se conservan.
- **Cobro duplicado o compensación:** reembolso (total del duplicado o parcial) + **Resolver caso** con el motivo. El acceso no cambia.
- **Deshacer una subida:** reembolso de la factura de la subida + **Revertir subida**. Vuelve el plan anterior sin cobro ni abono y se respeta el periodo ya pagado.
- **Mantener el acceso un tiempo:** **Conceder acceso hasta una fecha** (plan y fecha). Se puede retirar. No finge un pago.
- **Reembolso fallido:** el caso sale en rojo («Un reembolso ha fallado»). Revísalo en Stripe: el dinero no ha vuelto.

Cada intervención guarda la acción, el motivo (obligatorio), la nota, el autor, la fecha, el estado antes y después y el resultado (aplicada o fallida).

---

## C. Cómo ponerlo en producción

### C1. Bloqueos reales hoy (sin ellos no se activa)

0. **Alta fiscal** (01/10/2026: todavía no existe).
   - **Con Managed Payments (A0)** Stripe es el vendedor: emite la factura y declara el IVA. Ya no hace falta un registro de IVA propio para vender.
   - **Sigue pendiente con la gestoría** cómo declarar los ingresos que transfiere Stripe (IRPF) y si exigen un alta en Hacienda. Es responsabilidad vuestra, no del código.
   - **Si pasáis a Stripe Tax:** hay que elegir forma jurídica y darse de alta en Hacienda con IVA antes del primer cobro, porque en España el IVA se cobra desde la primera venta. Además, la cuenta de Stripe, el banco, las facturas y las condiciones deben estar a nombre de esa misma entidad.
1. Cuenta live activada, con banco y sin requisitos pendientes (A1).
2. Catálogo live, configuración de métodos de pago, portal, datos públicos, descriptor, correos, Stripe Tax y datos del emisor de la factura (A2 a A6).
3. Clave restringida live con los permisos de A7 y el webhook live con los 31 eventos.
4. **Datos que no están en el repositorio:**
   - condiciones de contratación publicadas (URL);
   - `facturacion@trainfit.net` creado;
   - dominio de Trainers confirmado con HTTPS;
   - validación de la asesoría.
5. **Build de la web de Trainers:** resuelto el 01/10/2026 (sin commit). Se quitó el panel `history` de `client-detail.page.html`, que había resucitado el merge `01846e9c`; el build compila sin errores.
6. Correo SES configurado en el servidor (`SES_SMTP_USER`, `SES_SMTP_PASS`, `SES_REGION`, `FROM_EMAIL`) para los avisos anuales.
7. Prueba real controlada (C7) superada.

### C2. Variables del servidor (sin valores secretos aquí)

Van en el entorno del backend de producción (el `.env` que usa PM2), **nunca** en el repositorio ni en el front. Plantilla comentada: `components/trainerBilling/production.env.example`.

```
TRAINER_BILLING_ENABLED=0                       # 1 solo tras el preflight en verde
TRAINER_BILLING_MODE=live
TRAINER_BILLING_TAX_POLICY=managed_payments    # o stripe_tax cuando haya NIF con IVA (A4)
TRAINER_BILLING_FRONTEND_URL=https://<dominio de Trainers>
TRAINER_BILLING_TERMS_URL=https://<URL de las condiciones>
TRAINER_BILLING_SUPPORT_EMAIL=facturacion@trainfit.net
STRIPE_KEY=rk_live_…
STRIPE_WEBHOOK_SECRET=whsec_…
STRIPE_TRAINER_PORTAL_CONFIGURATION_ID=bpc_…
STRIPE_TRAINER_PAYMENT_METHOD_CONFIGURATION_ID=pmc_…  # solo con stripe_tax
STRIPE_TRAINER_PRO_MONTHLY_PRICE_ID=price_…     # y los otros 5 precios
CORS_EXTRA_ORIGINS=https://<dominio de Trainers>
```

El código se niega a arrancar los pagos en live si:
- la clave no es `rk_live_`;
- la política fiscal no es `stripe_tax` ni `managed_payments`;
- el frontend no es https;
- faltan las condiciones o el buzón;
- falta la configuración de métodos de pago (solo con `stripe_tax`; con Managed Payments los elige Stripe).

El modo de pruebas no funciona con `NODE_ENV=production`.

`CORS_EXTRA_ORIGINS` admite solo orígenes `https` exactos (sin ruta) y se implementó el 28/09/2026. Antes estaba en la documentación pero no en el código.

La app de Gestión puede editar el `.env` del servidor. Si la usáis para esto, recordad que la clave y el secreto del webhook son secretos.

### C3. Migraciones y preparación de datos

No hay migraciones: todo es aditivo.
- Las colecciones nuevas `trainerbillingcases` y `trainerbillinginterventions` se crean con sus índices la primera vez que se usan.
- Los campos nuevos de `trainerbillingaccounts` (`hold`, `adjustments`, `reminders`, `termsAcceptance`) son opcionales.
- El campo antiguo `review` ya no se escribe ni se muestra.

No hay entrenadores con planes antiguos. No hay que importar nada.

### C4. Orden exacto de despliegue y activación

1. Configura la parte A en **live** (1–2 horas). No actives nada todavía.
2. Backend (Hetzner, compartido con la app de cliente):
   - `npm ci` con devDependencies (hace falta TypeScript) y `npm run build:ts`. PM2 arranca `bin/www` sin compilar: sin `.build` fallan los borrados de cuentas y las rutas de entrenador.
   - Añade las variables de C2 **con `TRAINER_BILLING_ENABLED=0`** y ejecuta `pm2 reload train-fit-back`. La app de cliente no cambia.
3. Web de Trainers: corrige antes el bloqueo C1.5, ejecuta `npm run build:pro:t`, sírvela en `https://<dominio de Trainers>` y comprueba que llama a la API de producción.
4. App de Gestión: despliégala como hoy (trae la pantalla «Facturación Trainers»).
5. En el servidor, ejecuta `npm run billing:preflight`. Todo debe salir en ✔; cada aviso (!) se comprueba a mano en el Dashboard.
6. Pon `TRAINER_BILLING_ENABLED=1` y ejecuta `pm2 reload train-fit-back`.
7. Prueba real controlada (C7) antes de anunciar nada.

### C5. Comprobaciones antes y después

- **Antes:**
  - preflight en verde;
  - `GET https://<API>/api/billing/trainer/plans` con un entrenador devuelve `enabled: true` y `mode: live`;
  - la web de Trainers carga sin errores de CORS;
  - Stripe muestra el webhook activo.
- **Después de activar:**
  - en Stripe → Webhooks, las entregas responden 200 (algún 409 aislado es normal: significa «reintenta», porque había una operación en curso sobre ese entrenador);
  - Gestión → Facturación Trainers no muestra «eventos sin procesar»;
  - el log de PM2 no tiene avisos `[TrainerBilling]` inesperados.

### C6. Reversión

- **Freno de emergencia** (siempre la primera opción): `TRAINER_BILLING_ENABLED=0` y `pm2 reload train-fit-back`.
  - Se detienen las altas, los cambios y las intervenciones. El acceso ya pagado se mantiene hasta su fecha.
  - Los webhooks devuelven 503 y Stripe los reintenta hasta 3 días.
  - Al reactivar: la reconciliación relee las suscripciones y la recuperación trae los eventos de dinero de las últimas 72 horas.
  - Si el freno dura **más de 3 días**: tras reactivar, revisad a mano en Stripe los reembolsos y disputas de ese intervalo.
- **Volver a una versión anterior del código:** solo con el freno puesto.
  - La versión anterior no entiende las pausas por disputa y volvería a cancelar suscripciones por un reembolso total.
  - Antes de volver atrás, reanudad o cancelad en Stripe las suscripciones con cobros en pausa (Gestión las marca).
- **Nunca** se borran en Stripe clientes ni suscripciones para «deshacer». El dinero se corrige con reembolsos o notas de crédito en Stripe.

### C7. Prueba real controlada (con tu tarjeta, justo tras activar)

1. Contrata Pro mensual: 35,09 € si eres particular en España.
   - Comprueba el acceso, la factura (IVA, tus datos y el NIF de TrainFit) y el correo de Stripe.
   - Comprueba que la sesión de Checkout pidió aceptar las condiciones.
2. Sube a Growth: el importe mostrado debe ser el cobrado.
3. En Stripe, reembolsa **entera la factura de la subida** con nota de crédito. En Gestión aparece un caso «Revertir subida»; aplícalo. Vuelves a Pro sin cobro y la renovación queda a 29 € + IVA.
4. Programa una bajada y descártala. Cancela la renovación y reactívala.
5. Abre el portal: cambia la tarjeta y tus datos fiscales y vuelve.
6. En Stripe, reembolsa el total del periodo. En Gestión, «Terminar servicio ahora»: pasas a Free y tus datos siguen.
7. Revisa que no quedan eventos sin procesar ni intervenciones fallidas.

### C8. Monitorización inicial (primeras 2–4 semanas) y cuándo parar

**A diario:**
- Gestión → Facturación Trainers: casos abiertos (prioridad alta primero; disputas por fecha límite) y el contador de eventos sin procesar.
- Stripe: pagos fallidos, disputas y webhooks.

**Pon el freno (C6) si ocurre algo de esto:**
- un cobro confirmado en Stripe sin acceso en TrainFit que no se arregla con «Actualizar estado» en 15 minutos;
- un cobro duplicado o dos suscripciones activas para el mismo entrenador;
- eventos sin procesar que crecen durante más de una hora, o el webhook fallando de forma continuada (no 409 sueltos);
- un precio distinto del catálogo o un IVA incorrecto en una factura real.

### C9. Qué hacer ante una incidencia

- **Cobro hecho sin acceso:**
  1. En la página de suscripción, «Actualizar estado» (lo pide el entrenador o lo haces con su cuenta).
  2. En Gestión, abre su ficha: estado de Stripe, pagado hasta y cobros en pausa.
  3. Si Stripe dice pagado y TrainFit no, mira los eventos sin procesar y el log.
  4. Mientras se arregla, **Conceder acceso hasta** mañana con el motivo «cobro verificado en Stripe».
  5. Nunca devuelvas el dinero «por si acaso».
- **Webhook fallando:**
  - Stripe → Webhooks → entregas: mira el código de respuesta.
    - 400: firma inválida. El secreto `whsec` no coincide: cópialo de nuevo.
    - 503 `BILLING_DISABLED`: el freno está puesto.
    - Otros 5xx: servidor. Mira el log de PM2.
  - Stripe reintenta 3 días y la reconciliación corrige el estado. Si el fallo duró más, revisa a mano los reembolsos y disputas.
- **Devolución:** sigue la parte B (siempre en Stripe y luego la decisión en Gestión).
- **Disputa:** sigue D3.
- **Aviso de fraude:** revisa el pago en Stripe. Si parece fraude, «Reembolsar como fraude» en Stripe y «Terminar servicio ahora» en Gestión (motivo «fraude»). Resuelve el caso.

---

## D. Operativa habitual

Responsables: **ambos** (Davvidar y sangovis98). Propuesta, a vuestra elección:
- la revisión diaria, por turnos;
- la semanal, conjunta, para que una persona repase las decisiones de la otra;
- la mensual, con la asesoría.

### D1. Cada día laborable (10 minutos)

1. **Gestión → Facturación Trainers → Abiertos.**
   - Atiende primero los de prioridad alta.
   - Disputas: respóndelas en Stripe antes de la fecha límite (Smart Disputes supervisado).
   - Reembolsos: registra la decisión.
   - Si el contador de eventos sin procesar no es 0, investígalo (C9).
2. **Stripe → Disputas** y **Pagos → fallidos:** no debe haber nada sin mirar.
3. **Buzón `facturacion@`:** primera respuesta humana en un día laborable; primero los cobros erróneos y los bloqueos de acceso.

### D2. Cada semana

- Suscripciones en `past_due` o impagadas en Stripe: comprueba que el entrenador recibió los avisos.
- Reembolsos que no estén «Completado».
- Intervenciones de la semana (Gestión, ficha de cada entrenador): la otra persona revisa el motivo y el efecto.
- Log de PM2: avisos `[TrainerBilling]`.
- Casos resueltos que se hayan **reabierto** (nuevo reembolso o cierre de disputa): decide otra vez.

### D3. Cómo se gestiona una disputa, paso a paso

1. Llega el email de Stripe y aparece en Gestión como caso alto, con los cobros ya pausados. Apunta la fecha límite.
2. Escribe al entrenador desde `facturacion@`. Si es un malentendido, que la retire; aun así, envía pruebas.
3. **Decide:**
   - **aceptarla:** pierdes el importe y la comisión;
   - **contestarla en Stripe:** hay comisión por contestar, que se devuelve si ganas.
   - Pruebas útiles:
     - la factura;
     - la aceptación de las condiciones (Gestión: «Condiciones aceptadas» con fecha);
     - el uso de la app (clientes y rutinas);
     - los pagos anteriores no disputados;
     - los emails.
   - Solo hay una entrega de pruebas: PDF, JPG o PNG, 4,5 MB como máximo y menos de 50 páginas.
4. **En Gestión, según el caso:**
   - si decides seguir cobrando, «Reanudar cobros»;
   - si no, «Cancelar renovación» o «Terminar servicio ahora» (fraude confirmado);
   - resuelve el caso con el motivo.
5. Al cerrarse (2–3 meses después) el caso se reabre solo:
   - **ganada:** vuelve el dinero;
   - **perdida:** TrainFit ya ha retirado lo financiado.
   - Decide los cobros y resuelve. No bloquees al entrenador para siempre: solo ante fraude o abuso documentado.

### D4. Cada mes

- Informe de IVA de Stripe Tax para la asesoría; revisa las facturas y las notas de crédito del mes.
- Tasa de disputas en el Dashboard (programas de las redes de tarjetas): cada disputa cuenta, aunque la ganes.
- `npm run billing:preflight` en el servidor: la configuración sigue en ✔.
- Revisa que la configuración de métodos de pago no ha cambiado y que el correo y la URL de condiciones siguen funcionando.

### D5. Glosario rápido

- **Reembolso:** devolver dinero de un cobro. No cambia nada más por sí solo.
- **Cancelar la renovación:** no volver a cobrar. Se conserva el acceso hasta el final del periodo pagado.
- **Terminar el servicio:** cancelar ya. El acceso de pago acaba hoy.
- **Prorrateo:** al cambiar de plan a mitad de periodo, abonar lo no usado y cobrar lo restante.
- **Saldo a favor:** crédito en Stripe que se descuenta de las facturas siguientes. No es dinero devuelto.
- **Pausa de cobros:** Stripe no cobra (las facturas quedan en borrador) mientras se resuelve una incidencia. El acceso ya pagado no cambia.
- **Excepción de acceso:** acceso de pago concedido hasta una fecha sin que haya cobro. Registrada y revocable.

---

## 6. Qué está verificado de verdad (28/09 y 01/10/2026)

- **Tests automáticos (01/10/2026):**
  - backend `npm test`: 1120/1120. Antes daba 1100 porque, al añadir los tests de pagos, dos rutas quedaron pegadas sin espacio y Node las tomaba como un patrón que no encontraba nada. Esos tests no se ejecutaban (seat-service y current-plans);
  - front `npm test`: 146/146;
  - TypeScript estricto del módulo de pagos sin errores;
  - `eslint no-undef` limpio en lo tocado.
- **Builds de Angular:**
  - Gestión: compila con 0 errores (52 avisos de «unused», por debajo de la línea base de 54).
  - Trainers: compila sin errores el 01/10/2026, tras quitar el bloque `history` que había resucitado un merge (C1.5).
- **Managed Payments en el sandbox (01/10/2026):** 12/12, ver A0. El pago se hizo en la página real de Checkout con la tarjeta de prueba de Stripe.
- **Sandbox de Stripe** (arnés `.stripe-local/claude/verify-money.cjs`, sin puerto 3000 ni BD compartida). Resultados en `verify-money-results.jsonl`:
  - reembolso de subida con caso y reversión sin cobro;
  - reembolso total con caso y terminar servicio;
  - reembolso parcial;
  - disputa abierta con pausa real en Stripe, perdida y ganada;
  - aviso de fraude;
  - firma inválida, duplicados y desorden;
  - recuperación de eventos;
  - concurrencia de intervenciones;
  - avisos anuales con reloj de pruebas.
  - Consulta en el informe de entrega qué pasó y qué no.
- **Sin verificar:** nada en live. Tampoco la pantalla de Gestión ni la de suscripción en un navegador con sesión real (no se pueden introducir contraseñas desde aquí): solo tests y compilación.
