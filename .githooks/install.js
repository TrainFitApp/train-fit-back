// Activa los hooks versionados de .githooks/ en este clon. Lo lanza `npm
// install` vía el script `prepare`. Fuera de un repo git (un build que copia el
// código sin .git) no hace nada: nunca debe romper la instalación.
const { execSync } = require("child_process");

try {
  execSync("git rev-parse --git-dir", { stdio: "ignore" });
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
} catch {
  // Sin git o sin repo: nada que activar.
}
