// Antes de escribir en una base: dice cuál es y pide teclear su nombre.
// `--confirm=<nombre>` lo da por tecleado (para lanzarlo sin terminal). El
// .env de desarrollo apunta a PRE, que va en el modelo viejo hasta el día D:
// un `npm run migrate` sin querer no debe poder tocarla.

const readline = require("readline");

// null si lo tecleado es el nombre de la base; si no, el motivo para parar.
function confirmationError(dbName, typed) {
  if (typed == null) return `Para escribir en "${dbName}" hay que confirmarlo: teclea su nombre o pasa --confirm=${dbName}.`;
  if (String(typed).trim() !== dbName) return `"${String(typed).trim()}" no es "${dbName}": no se ha hecho nada.`;
  return null;
}

function ask(question) {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    prompt.question(question, (answer) => {
      prompt.close();
      resolve(answer);
    });
  });
}

/**
 * Enseña la base (`uri` ya sin contraseña, nombre y tamaño) y lanza un error
 * si no se confirma. `confirm` es lo pasado en `--confirm=`; sin él se
 * pregunta, y sin terminal no se puede confirmar.
 */
async function confirmTarget(db, { uri, action, confirm = null, interactive = process.stdin.isTTY, log = () => {} }) {
  const users = await db.collection("users").estimatedDocumentCount();
  const products = await db.collection("products").estimatedDocumentCount();
  log(`${action} en ${uri} · base "${db.databaseName}" · ${users} usuarios, ${products} productos`);
  const typed = confirm ?? (interactive ? await ask(`Escribe "${db.databaseName}" para continuar: `) : null);
  const error = confirmationError(db.databaseName, typed);
  if (error) throw new Error(error);
}

const confirmArg = (argv) => argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length) ?? null;

module.exports = { confirmTarget, confirmationError, confirmArg };
