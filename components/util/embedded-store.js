// Escritura de documentos con contenido EMBEBIDO (2026-10): una sesión con
// sus ejercicios y series, un día de dieta con sus comidas y alimentos, una
// receta con sus ingredientes, una plantilla de dieta con sus menús.
//
// Varias rutas cambian el mismo documento a la vez (el cliente marca una
// serie o un alimento mientras otra pantalla guarda el resto). Las
// operaciones que leen, cambian y reescriben un array embebido lo hacen con
// compare-and-swap sobre `__v`: si alguien escribió entretanto, se vuelve a
// leer y a aplicar el cambio (mismo patrón que los cobros, que tampoco usan
// transacciones). Toda escritura directa sobre uno de estos documentos
// incrementa `__v` para que estas la noten.
//
// Además, utilidades para recorrer el árbol embebido buscando un nodo por su
// `_id`, venga de donde venga.

const MAX_ATTEMPTS = 10;

// Entre intentos, una espera corta y aleatoria: varias escrituras chocando a
// la vez no vuelven a chocar en el mismo instante.
const backoff = (attempt) => new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 15) + attempt * 5));

class ConcurrentUpdateError extends Error {
  constructor(message = "El documento ha cambiado mientras se guardaba. Vuelve a intentarlo.", code = "CONCURRENT_UPDATE") {
    super(message);
    this.status = 409;
    this.code = code;
    this.publicMessage = message;
  }
}

/**
 * Lee el documento de `Model` que casa con `filter` (en plano y sin poblar),
 * deja que `mutate` calcule los campos de primer nivel que cambian
 * (`{ campo: valorNuevo }`, o null si no hay nada que escribir) y los escribe
 * solo si nadie tocó el documento entretanto. Devuelve el documento ya
 * escrito (en plano) o null si no existe.
 */
async function mutateDocument(Model, filter, mutate, { onConflict } = {}) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await backoff(attempt);
    const current = await Model.findOne(filter).setOptions({ autopopulate: false }).lean();
    if (!current) return null;

    const changes = await mutate(current);
    if (!changes || !Object.keys(changes).length) return current;

    const result = await Model.updateOne(
      { _id: current._id, __v: current.__v ?? null },
      { $set: changes, $inc: { __v: 1 } },
      { runValidators: true },
    );
    if (result.matchedCount) return { ...current, ...changes, __v: (current.__v || 0) + 1 };
  }
  throw onConflict ? onConflict() : new ConcurrentUpdateError();
}

const idOf = (value) => {
  const raw = value?._id ?? value;
  return raw == null ? null : String(raw);
};

/**
 * Busca en profundidad, dentro de los arrays de `root`, el objeto cuyo `_id`
 * es `id`. Devuelve { node, array, index, keys } — `keys` es el camino de
 * claves de array desde la raíz (p. ej. ["meals", "customRecipes",
 * "addedCustomProducts"]) — o null.
 */
function findNode(root, id, keys = []) {
  const target = String(id);
  if (!root || typeof root !== "object") return null;
  for (const [key, value] of Object.entries(root)) {
    if (!Array.isArray(value)) continue;
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (!item || typeof item !== "object" || item._bsontype) continue;
      if (idOf(item) === target) return { node: item, array: value, index, keys: [...keys, key] };
      const nested = findNode(item, target, [...keys, key]);
      if (nested) return nested;
    }
  }
  return null;
}

/**
 * Copia de `root` en la que `transform` sustituye cada objeto de un array
 * (de abajo arriba). `transform(node, keys)` devuelve el nodo nuevo, el mismo
 * o null para quitarlo del array.
 */
function mapNodes(root, transform, keys = []) {
  if (!root || typeof root !== "object" || root._bsontype || root instanceof Date) return root;
  const copy = Array.isArray(root) ? [] : { ...root };
  for (const [key, value] of Object.entries(root)) {
    if (!Array.isArray(value)) continue;
    const path = [...keys, key];
    copy[key] = value
      .map((item) => {
        if (!item || typeof item !== "object" || item._bsontype || item instanceof Date) return item;
        return transform(mapNodes(item, transform, path), path);
      })
      .filter((item) => item !== null);
  }
  return copy;
}

module.exports = { mutateDocument, ConcurrentUpdateError, findNode, mapNodes, idOf, MAX_ATTEMPTS };
