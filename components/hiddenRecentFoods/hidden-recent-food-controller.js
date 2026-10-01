const mongoose = require("mongoose");
const hiddenRecentFoodService = require("./hidden-recent-food-service");

const KINDS = new Set(["product", "recipe"]);
const MAX_MEAL_INDEX = 20;
const MAX_IDS = 50;

// Devuelve { mealIndex, kind, ids, all } o null si el cuerpo no es válido.
// `all` solo se admite al ocultar: deshacer es siempre por elementos.
function parseInput(body, { allowAll }) {
  const source = body || {};
  const mealIndex = Number(source.mealIndex);
  if (!Number.isInteger(mealIndex) || mealIndex < 0 || mealIndex > MAX_MEAL_INDEX) return null;
  if (!KINDS.has(source.kind)) return null;

  if (allowAll && source.all === true) {
    return { mealIndex, kind: source.kind, ids: [], all: true };
  }

  const ids = Array.isArray(source.ids) ? source.ids : [];
  if (!ids.length || ids.length > MAX_IDS || !ids.every((id) => mongoose.isValidObjectId(id))) {
    return null;
  }
  return { mealIndex, kind: source.kind, ids: [...new Set(ids.map(String))], all: false };
}

function rejectInvalid(res) {
  return res.status(400).send({ message: "Datos de recientes no válidos", code: "RECENT_FOODS_INVALID" });
}

module.exports = {
  // POST /recent-foods/hidden
  // body: { mealIndex, kind: "product" | "recipe", ids: string[] } o { mealIndex, kind, all: true }
  async hide(req, res) {
    const input = parseInput(req.body, { allowAll: true });
    if (!input) return rejectInvalid(res);
    return res.send(await hiddenRecentFoodService.hide(req.auth.userId, input));
  },

  // POST /recent-foods/hidden/restore
  // body: { mealIndex, kind, ids: string[] } — deshace una ocultación suelta.
  async restore(req, res) {
    const input = parseInput(req.body, { allowAll: false });
    if (!input) return rejectInvalid(res);
    return res.send(await hiddenRecentFoodService.restore(req.auth.userId, input));
  },
};
