# Antes de subir a PRO

> Estado a **2026-10-10**. Checklist única del paso de `develop` a producción.
> El detalle de cada punto está enlazado; tacha lo que se cierre. La copia viva
> con más contexto (fuera de git) es `TrainFit/docs/pendientes.md`.

## Dónde estamos

- `develop` lleva todo lo nuevo:
  - el refactor del modelo de datos (2026-10-06/07);
  - el QA entrenador ↔ cliente con sus arreglos;
  - la revisión de pagos de Stripe.
- Último commit de `develop`: back `077ae1a`, front `ef68dfd5`. Los dos pasaron
  `npm run verify`: back 1988 tests, front 709.
- `main` (PRO) va muy por detrás: 192 commits en el back y 255 en el front,
  desde el 2026-08-21.
- **Push a `main` = despliegue**:
  - Cloudflare publica solo la web de trainers de PRO (`train-fit-trainers`).
  - La API de PRO se despliega a mano con PM2.
  - **No fusionar `develop` en `main` hasta el día D**: la web nueva contra la
    API vieja no funciona.
- El modelo de datos cambió sin capa de compatibilidad. Back y apps salen
  **juntos**, con actualización forzada (`remoteConfig.forceUpdate`).
  - Contratos que cambian en esta tanda: `Set.expectedWeight` (la carga
    pautada ya no va en `weight`).
  - Notificaciones nuevas `diet_phase_assigned` y `supplement_assigned`.
  - Rutas retiradas (ver `TrainFit/docs/CONTEXT.md`, «Sin legado»).

## Bloqueantes

### 1. PRE no está migrado

- [ ] **La base `pre` no tiene ninguna migración**, mientras Render despliega
      `develop` (con el refactor) en PRE.
  - Comprobado en lectura el 2026-10-10 contra la base del `.env` local.
  - `schemamigrations` no existe y siguen `sets`, `splits`,
    `customproducts` y `meals`.
  - Confirmar en Render que su `MONGODB_URI` apunta a esa misma base `pre`.
  - Mientras tanto, PRE corre código nuevo sobre datos viejos: lo de
    entrenamiento y diario no es fiable.
  - Nunca migrar en vivo. Pasos:
    1. Mantenimiento en PRE.
    2. `mongodump`.
    3. `npm run migrate:dry-run`.
    4. `npm run migrate` (pide teclear el nombre de la base).
    5. `npm run presets`.
    6. Probar las tres apps de PRE.
  - Es el «falta repetirlo con PRE» de `TrainFit/docs/pendientes.md` §7.

### 2. Ensayo de la migración con los pasos nuevos

- [ ] Repetir el ensayo fiel sobre una copia reciente de PRO.
  - El del 2026-10-09 llegó al paso 26.
  - Desde entonces hay dos pasos más:
    - `27-expected-weight`: la carga pautada de las series sin hacer pasa de
      `weight` a `expectedWeight`.
    - `28-cardio-habits`: los hábitos de cardio pasan a hábitos propios
      «Cardio».
  - Procedimiento en `TrainFit/docs/pendientes.md` §7, incluida la
    exportación de la víspera.

### 3. Stripe (facturación de trainers)

Ver `docs/auditoria-stripe-2026-10-09.md` §H–I y
`components/trainerBilling/README.md`.

- [ ] **Permisos de la clave restringida** en sandbox, PRE y live.
  - El preflight del 2026-10-10 con la clave de sandbox dio que no puede
    escribir suscripciones, calendarios de suscripción ni sesiones del
    portal.
  - Con eso se puede contratar, pero fallan cambiar de plan, cancelar,
    reactivar y abrir el portal.
  - Es la causa más probable de STRIPE-010.
  - Dashboard → Desarrolladores → Claves de API: dar escritura en
    Subscriptions, Subscription schedules y Customer portal.
- [ ] `npm run billing:preflight` en ✔ en PRE y en el servidor de PRO con la
      clave live.
- [ ] Portal predeterminado con enlaces a condiciones y privacidad (hoy ✘ en
      sandbox).
- [ ] `STRIPE_SUPPORT_EMAIL` (`facturacion@trainfit.net`) en cada entorno: sin
      él, los mensajes «Escríbenos» no llevan buzón.
- [ ] Condiciones de trainers publicadas en la URL de `STRIPE_TERMS_URL`
      (STRIPE-014). La misma URL debe estar en Stripe → Datos públicos: sin
      ella, Checkout no abre.
- [ ] En PRE, de punta a punta con tarjeta de prueba:
  - contratar y volver (`sync`);
  - subir plan y plazas;
  - bajar (programado);
  - cancelar y reactivar;
  - portal y facturas.
  - Renovación e impago con reloj de pruebas (STRIPE-015).
- [ ] Parte C de `docs/stripe-trainers-guia.md`: alta fiscal, cuenta live,
      `npm run stripe:catalog` live, webhook live (31 eventos, versión
      `2026-08-26.dahlia`), Managed Payments «Listo para usar» y prueba real
      controlada.
- [ ] Quitar los entitlements de entrenador en RevenueCat: los entrenadores
      ya solo pagan por Stripe.

### 4. Variables de entorno de PRO

- [ ] Correo por Resend: `RESEND_API_KEY` y `REGISTRATION_NOTIFICATION_EMAIL`.
      SES y Gmail ya no existen en el código. Checklist en
      `TrainFit/docs/plan-correo-resend.md`.
- [ ] RevenueCat: el secreto del webhook y la clave de API. Si falta, falla
      cerrado y nadie obtiene premium.
- [ ] R2 y Bunny Stream para fotos y vídeos. Sin ellos se usa disco local,
      que solo vale en dev.
- [ ] Las cinco `STRIPE_*` (live) y quitar las variables antiguas.

### 5. Legal y web pública

- [ ] NIF y domicilio en `train-fit-web/src/data/site.ts`.
- [ ] Condiciones de trainers sin el aviso de borrador y con fecha de
      entrada en vigor.
- [ ] Revisión de la asesoría (lista en `TrainFit/docs/pendientes.md` §3).
- [ ] Web publicada antes de liberar las apps: enlazan a `/terminos/`,
      `/privacidad/` y `/condiciones-trainers/2026-10/`.

### 6. Apps

- [ ] Versiones nuevas de las tres apps en las tiendas, **retenidas** hasta
      el despliegue del back.
- [ ] Versión mínima en `remoteConfig` el día D.

## Comprobaciones a mano pendientes

La automatización no las pudo cerrar el 2026-10-10.

- [ ] **Login de trainers**: Enter en la contraseña con un teclado real.
  - Con el evento del navegador envía.
  - Con la tecla que inyecta la herramienta, no.
- [ ] **Recarga completa de la web de trainers**: la pantalla negra con el
      logo duró unos 5 s en dev (`/tabs/subscription`). Medirlo con el
      build de PRE.
- [ ] Recorrido del cliente en móvil (nativo) con la versión nueva:
  - registro con verificación;
  - cuestionario de alta;
  - entrenar con carga pautada (sale como sugerencia, se apunta lo
    levantado);
  - diario con comidas pautadas;
  - check-in;
  - «Tus profesionales» con sus cobros.

## Decisiones abiertas

- Gestión › Facturación de trainers: los textos están en español a propósito
  (operativa interna, ver `trainer-billing-view.util.ts`). Decidir si pasan
  a i18n como el resto.
- Plantillas de Stripe duplicadas (`.stripe.env.example` y
  `components/trainerBilling/stripe.env.example`): ver `pendientes.md` §0.
- Tope de almacenamiento o retención de la media de los clientes.

## Día D

El orden detallado está en `TrainFit/docs/pendientes.md` §7:

1. Backup de PRO con `mongodump --gzip --archive`.
2. Versión mínima nueva y mantenimiento activado.
3. `npm run migrate` y `npm run presets`.
4. Fusionar `develop` en `main` en los dos repos. Eso publica la web de
   trainers.
5. Desplegar la API con PM2 y liberar las apps.
6. Quitar el mantenimiento y comprobar.

Unos días después, `npm run migrate -- --drop-old`. Todo fuera de
03:45–04:30 UTC (conciliación de RevenueCat).

## Dónde está cada cosa

| Qué | Dónde |
| --- | --- |
| Contexto del proyecto y reglas | `TrainFit/docs/CONTEXT.md` (empieza por ahí) |
| QA entrenador ↔ cliente y su estado | `TrainFit/docs/qa-entrenador-cliente.md` |
| Lista viva de pendientes | `TrainFit/docs/pendientes.md` |
| Refactor del modelo de datos y su despliegue | `TrainFit/docs/refactor-modelo-datos-estado.md` |
| Auditoría y comportamiento de Stripe | `docs/auditoria-stripe-2026-10-09.md`, `components/trainerBilling/README.md` |
| Migraciones | `scripts/migrations/NN-*.js`, tabla en `TrainFit/docs/backend.md#migraciones` |

La carpeta `TrainFit/docs/` no está en ningún repo: vive en el Mac del
proyecto. Esta lista sí va en el repo para que esté en cualquier copia.

Para probar en local sin tocar PRE:

- Base Docker `mongo-testdb`, puerto 27018, base `trainfit_qa`, con la copia
  de PRO migrada.
- Entrada `api-stripe-qa` de `TrainFit/.claude/launch.json`: API contra esa
  base, Stripe en sandbox y vuelta a la web de trainers en 8102.
- Cuentas `qa-trainer@`, `qa-trainer2@`, `qa-trainer3@`, `qa-client@`,
  `qa-client2@`…`qa-client5@` y `qa-admin@` (todas `@trainfit.net`), más
  `t@t.t` y `u@u.u`.
  - Contraseña: la de `scripts/seed-test-trainer-client.js`.
  - Solo existen en esa base local, nunca en PRE ni en PRO.
