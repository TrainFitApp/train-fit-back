// Qué CONTENIDO rige en una fecha dentro de una fase, y cuándo dos contenidos
// son el mismo (docs/plan-semanas.md).
//
// No hay un documento por semana: solo se persiste el contenido que CAMBIA
// algo. El head de la fase es el primero, y cada vez que el entrenador
// prepara la semana siguiente con comida o cantidades distintas se guarda
// otro con su fecha de inicio. Las semanas intermedias heredan del último
// persistido que ya había empezado.
//
// PURO: ni reloj ni BD.

/** El contenido persistido que rige en `date` (el último que ya empezó). */
function overrideAt(members, date) {
  let found = null;
  for (const member of members || []) {
    if (member.startDate && member.startDate <= date) found = member;
  }
  return found;
}

/**
 * Firma normalizada del contenido: qué alimentos y en qué cantidad, sin ids
 * ni orden. Si dos firmas coinciden, preparar la semana siguiente no
 * cambiaría nada y no se persiste.
 */
function contentSignature({ menus }) {
  const item = (x) => ({
    ref: String(x?.product?._id || x?.product || x?.recipe?._id || x?.recipe || x?.name || ""),
    q: Math.round(Number(x?.quantity) || 0),
  });
  const meal = (m) => ({
    name: m?.name || "",
    alts: (m?.alternatives || []).map((a) => ({
      p: (a?.customProducts || []).map(item).sort((x, y) => x.ref.localeCompare(y.ref)),
      r: (a?.customRecipes || []).map(item).sort((x, y) => x.ref.localeCompare(y.ref)),
    })),
  });
  return JSON.stringify(
    (menus || []).map((menu) => ({ name: menu?.name || "", meals: (menu?.meals || []).map(meal) }))
  );
}

module.exports = { overrideAt, contentSignature };
