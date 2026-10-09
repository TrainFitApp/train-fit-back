// Qué CONTENIDO de una fase rige en una fecha, y cuándo dos contenidos son el
// mismo (docs/plan-semanas.md).
//
// No hay un contenido por semana: solo se guarda el que CAMBIA algo
// (DietPhase.contents, por fecha de inicio). El primero empieza con la fase y
// cada vez que el profesional prepara la semana siguiente con comida o
// cantidades distintas se añade otro desde su lunes. Las semanas intermedias
// heredan del último que ya había empezado.
//
// PURO: ni reloj ni BD.

const { addDaysToIsoDate } = require("../util/date-util");

/** El contenido que rige en `date` (el último que ya empezó), o null. */
function contentAt(contents, date) {
  let found = null;
  for (const content of contents || []) {
    if (content.startDate && content.startDate <= date) found = content;
  }
  return found;
}

/**
 * El contenido que rige `date` entre varias fases ya cargadas: el de la fase
 * que la cubre (la que empieza más tarde de las que la contienen;
 * diet-phase-dao.js#findCoveringDate ordena igual) y, dentro de ella, la
 * última versión que ya empezó (una semana preparada tapa a la anterior
 * desde su lunes). `{ phase, content }`, o null.
 */
function coveringContent(phases, date) {
  let best = null;
  for (const phase of phases || []) {
    if (!phase?.startDate || phase.startDate > date) continue;
    if (phase.endDate && phase.endDate < date) continue;
    // Mismo desempate que findCoveringDate: a igual inicio, la más reciente.
    if (
      !best ||
      phase.startDate > best.startDate ||
      (phase.startDate === best.startDate && new Date(phase.createdAt || 0) > new Date(best.createdAt || 0))
    ) best = phase;
  }
  const content = best ? contentAt(best.contents, date) : null;
  return content ? { phase: best, content } : null;
}

/** Hasta qué día rige un contenido: el anterior al siguiente, o el fin de la fase. */
function contentEnd(phase, content) {
  const contents = phase.contents || [];
  const index = contents.findIndex((candidate) => String(candidate._id) === String(content._id));
  const next = index >= 0 ? contents[index + 1] : null;
  return next ? addDaysToIsoDate(next.startDate, -1) : phase.endDate || null;
}

/**
 * Firma normalizada del contenido: qué alimentos y en qué cantidad, sin ids
 * ni orden. Si dos firmas coinciden, preparar la semana siguiente no
 * cambiaría nada y no se guarda.
 */
function contentSignature({ menus }) {
  const item = (x) => ({
    ref: String(x?.product?._id || x?.product || x?.recipe?._id || x?.recipe || x?.name || ""),
    q: Math.round(Number(x?.quantity) || 0),
  });
  const meal = (m) => ({
    slot: m?.slot || "",
    alts: (m?.alternatives || []).map((a) => ({
      p: (a?.customProducts || []).map(item).sort((x, y) => x.ref.localeCompare(y.ref)),
      r: (a?.customRecipes || []).map(item).sort((x, y) => x.ref.localeCompare(y.ref)),
    })),
  });
  return JSON.stringify(
    (menus || []).map((menu) => ({ name: menu?.name || "", meals: (menu?.meals || []).map(meal) }))
  );
}

module.exports = { contentAt, coveringContent, contentEnd, contentSignature };
