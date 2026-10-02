# Workflows de la API

| Rama | Entorno | Despliegue | CI |
| --- | --- | --- | --- |
| `develop` | PRE | Render, automático en cada push | ninguno |
| `main` | PRO | PM2 en el servidor, a mano | `api-ci.yml`: lint + build TS + tests |

`api-ci.yml` **no despliega** y no usa secretos. Se lanza con cada push a
`main` o a mano desde *Actions → API CI → Run workflow*. Si falla, PRO no se
entera: el deploy es manual, así que el run en rojo es el aviso para no
desplegar ese commit.

Lo que protege `develop` es el hook local `.githooks/pre-push` (`npm run
verify`, lint + tests, antes de cualquier push a `develop` o `main`): Render
despliega PRE sin pasar por ningún check.

Los tests necesitan **Node ≥ 22**: `npm test` le pasa globs a `node --test`, que
Node 20 no entiende. El hook lo comprueba antes y el CI usa Node 22.

## Configuración de cada entorno

Las credenciales de la aplicación no pasan por GitHub: las lee el proceso de su
propio entorno.

| Entorno | Dónde están las variables | MongoDB |
| --- | --- | --- |
| PRE | Variables de entorno del servicio de Render | cluster de Atlas de PRE |
| PRO | `.env` del servidor con PM2 | cluster de Atlas de PRO |

La lista completa, agrupada y comentada, está en
[`.env.example`](../../.env.example). La URI la monta `scripts/_mongo-uri.js`:
con `MONGODB_URI` entera, o con `MONGODB_CLUSTER` + `MONGODB_DB` +
`MONGODB_USER` + `MONGODB_PASS`.

Lo que obligatoriamente difiere entre PRE y PRO:

- `MONGODB_*`: clusters distintos.
- `PRIVATE_KEY` / `PUBLIC_KEY`: pares RSA distintos, para que un token de PRE
  no valga en PRO.
- `STRIPE_*`: claves de test en PRE, live en PRO.
- `R2_*` / `BUNNY_*`: buckets y librerías distintas.
- `TRAINER_BILLING_FRONTEND_URL`, `VERIFY_BASE_URL`, `SERVER_DOMAIN`: apuntan a
  `trainers-pre.trainfit.net` / `trainers.trainfit.net`.

## Despliegue de PRO

En el servidor, después de que `API CI` salga en verde:

1. `git pull` (o el botón del panel de management).
2. `npm ci --omit=dev` si cambiaron dependencias.
3. `npm run build:ts`: PM2 arranca `bin/www` sin `prestart`.
4. Migraciones e índices del commit (`npm run migrate:*`,
   `npm run rebuild:search-indexes`), con `:dry-run` primero.
5. `pm2 reload train-fit-back`.
