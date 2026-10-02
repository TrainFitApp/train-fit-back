const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// Guardarraíl del propio runner.
//
// Hasta 2026-10 el script `test` llevaba la lista de ficheros escrita a mano:
// 80 ficheros de test en disco y 64 en la lista. Entre los que se quedaban
// fuera había uno que ya no pasaba (webhook-route, con la lista de
// dependencias de app.js desfasada) y 4 que nadie ejecutaba en el CI normal.
//
// Ahora el script usa globs, y este test comprueba que cubren TODO lo que hay
// en disco: si alguien deja un test en una carpeta que los globs no miran,
// falla aquí en vez de no ejecutarse nunca en silencio.

const ROOT = path.resolve(__dirname, "../..");

// Mismas raíces que los globs de `npm test` en package.json. Al añadir una
// carpeta nueva ahí, hay que añadirla aquí (y este test avisa si no).
const COVERED_ROOTS = ["components/", "services/", "middleware/", "scripts/", "integration/"];

// Ni dependencias ni salidas de build (.build son los .js que genera tsc
// desde los .ts de trainerBilling/trainerPayments).
const IGNORED_DIR = new Set(["node_modules", ".git", ".build", "coverage"]);

function findTestFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIR.has(entry.name)) continue;
      findTestFiles(path.join(dir, entry.name), acc);
    } else if (/\.test\.(js|cjs|mjs)$/.test(entry.name)) {
      acc.push(path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join("/"));
    }
  }
  return acc;
}

test("todo fichero de test vive en una raíz que `npm test` recorre", () => {
  const uncovered = findTestFiles(ROOT).filter(
    (rel) => !COVERED_ROOTS.some((root) => rel.startsWith(root)),
  );
  assert.deepEqual(
    uncovered,
    [],
    "Estos tests no los ejecuta `npm test`: muévelos a components/, services/, " +
      "middleware/, scripts/ o integration/, o añade su raíz a los globs del script `test` " +
      "en package.json y a COVERED_ROOTS aquí.",
  );
});

test("los globs solo aceptan .js: un .test.cjs no se ejecutaría", () => {
  const wrongExtension = findTestFiles(ROOT).filter((rel) => /\.test\.(cjs|mjs)$/.test(rel));
  assert.deepEqual(
    wrongExtension,
    [],
    "Renómbralos a .test.js: el backend es CommonJS y los globs del script " +
      "`test` solo recogen .js.",
  );
});
