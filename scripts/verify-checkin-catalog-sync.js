const path = require("path");
const fs = require("fs");

const LOG_PREFIX = "[verify-checkin-catalog-sync]";
const log = (...args) => console.log(LOG_PREFIX, ...args);
const ok = (...args) => console.log(LOG_PREFIX, "OK", ...args);

// TASK-050 (MASTER_BACKLOG.md) — checkin-field-catalog.js (backend) es,
// según su propio comentario, un "espejo EXACTO mantenido a mano" de
// checkin-fields.ts (frontend). Verdadera fuente única (un JSON leído por
// ambos lados) exigiría un cambio de infraestructura más grande de lo que
// justifica esta tarea: train-fit-back y train-fit-front son dos proyectos
// npm independientes en carpetas hermanas, no un único workspace — no hay
// forma limpia de que uno importe un archivo del otro sin symlinks o un
// paquete publicado nuevo. En su lugar, este script convierte el riesgo de
// "deriva silenciosa" (nadie se entera hasta que un campo falla en
// producción) en "deriva detectada" (este script falla si algún día
// diverge) — ejecutable a mano o en CI antes de cada release.
// `marker` debe terminar exactamente en el "[" de apertura del array —
// ojo con anotaciones de tipo TS que contengan un "[" propio antes (p. ej.
// "CheckinField[]"), por eso NO se re-busca "[" desde cero: se usa
// directamente el final del propio marcador como inicio real del array.
function extractArrayLiteral(source, marker) {
  const startIdx = source.indexOf(marker);
  if (startIdx === -1) throw new Error(`No se encontró "${marker}" en el archivo`);

  const bracketStart = startIdx + marker.length - 1;
  if (source[bracketStart] !== "[") {
    throw new Error(`El marcador "${marker}" debe terminar en "[" (encontrado: "${source[bracketStart]}")`);
  }

  let depth = 0;
  let i = bracketStart;
  for (; i < source.length; i++) {
    if (source[i] === "[") depth++;
    else if (source[i] === "]") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) throw new Error(`No se encontró el "]" de cierre para "${constName}"`);

  const literal = source.slice(bracketStart, i + 1);
  // eslint-disable-next-line no-new-func -- fuente propia y de confianza (archivo del repo), no input externo.
  return new Function(`return ${literal};`)();
}

function normalizeField(field) {
  // Orden de claves irrelevante para la comparación — solo importa el contenido.
  const { key, label, type, unit, group, storage, anthropometryField } = field;
  return { key, label, type, unit: unit ?? null, group, storage, anthropometryField: anthropometryField ?? null };
}

function main() {
  const backendPath = path.resolve(__dirname, "../components/trainerCheckins/checkin-field-catalog.js");
  const frontendPath = path.resolve(
    __dirname,
    "../../train-fit-front/packages/shared-core/src/app/core/constants/checkin-fields.ts"
  );

  log(`backend:  ${backendPath}`);
  log(`frontend: ${frontendPath}`);

  if (!fs.existsSync(frontendPath)) {
    console.error(`${LOG_PREFIX} FAIL`, `no se encontró el archivo frontend — ¿se movió checkin-fields.ts?`);
    process.exit(1);
  }

  const backendSource = fs.readFileSync(backendPath, "utf8");
  const frontendSource = fs.readFileSync(frontendPath, "utf8");

  const backendFields = extractArrayLiteral(backendSource, "CHECKIN_FIELDS = [").map(normalizeField);
  // El frontend declara "export const CHECKIN_FIELDS: CheckinField[] = [" — el
  // marcador de búsqueda debe coincidir con ESE texto, no con el del backend.
  const frontendFields = extractArrayLiteral(frontendSource, "CHECKIN_FIELDS: CheckinField[] = [").map(
    normalizeField
  );

  ok(`${backendFields.length} campos leídos del backend`);
  ok(`${frontendFields.length} campos leídos del frontend`);

  const errors = [];

  if (backendFields.length !== frontendFields.length) {
    errors.push(
      `Nº de campos distinto: backend=${backendFields.length}, frontend=${frontendFields.length}`
    );
  }

  const backendByKey = new Map(backendFields.map((f) => [f.key, f]));
  const frontendByKey = new Map(frontendFields.map((f) => [f.key, f]));

  for (const key of backendByKey.keys()) {
    if (!frontendByKey.has(key)) errors.push(`Campo "${key}" existe en backend pero no en frontend`);
  }
  for (const key of frontendByKey.keys()) {
    if (!backendByKey.has(key)) errors.push(`Campo "${key}" existe en frontend pero no en backend`);
  }

  for (const key of backendByKey.keys()) {
    if (!frontendByKey.has(key)) continue;
    const b = backendByKey.get(key);
    const f = frontendByKey.get(key);
    const bJson = JSON.stringify(b);
    const fJson = JSON.stringify(f);
    if (bJson !== fJson) {
      errors.push(`Campo "${key}" difiere entre backend y frontend:\n  backend:  ${bJson}\n  frontend: ${fJson}`);
    }
  }

  if (errors.length) {
    console.error(`${LOG_PREFIX} FAIL — el catálogo ha divergido:`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  ok("los 2 catálogos son idénticos, campo a campo");
  console.log(`${LOG_PREFIX} PASS`);
}

main();
