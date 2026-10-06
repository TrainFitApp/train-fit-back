const mongoose = require("mongoose");
const recentFoodService = require("./recent-food-service");
const { canActOnSubject } = require("../trainerClients/subject-access");

const KINDS = new Set(["product", "recipe"]);
const MAX_MEAL_INDEX = 20;
const MAX_IDS = 50;

function parseMealIndex(value) {
  const mealIndex = Number(value);
  return Number.isInteger(mealIndex) && mealIndex >= 0 && mealIndex <= MAX_MEAL_INDEX ? mealIndex : null;
}

// Devuelve { mealIndex, kind, ids, all } o null si el cuerpo no es válido.
// `all` solo se admite al ocultar: deshacer es siempre por elementos.
function parseHideInput(body, { allowAll }) {
  const source = body || {};
  const mealIndex = parseMealIndex(source.mealIndex);
  if (mealIndex === null || !KINDS.has(source.kind)) return null;

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

// Recientes del propio usuario, o de un cliente de nutrición del profesional
// que pauta (?userId=).
function recentList(listFn) {
  return async (req, res) => {
    const mealIndex = parseMealIndex(req.query.mealIndex ?? 0);
    if (mealIndex === null) return rejectInvalid(res);
    const userId = req.query.userId || req.auth.userId;
    if (!mongoose.isValidObjectId(userId)) return rejectInvalid(res);
    if (!(await canActOnSubject(req, userId, { trainerScope: "nutrition" }))) {
      return res.status(403).send({ message: "No tienes permiso sobre los recientes de este usuario" });
    }
    const limit = Number.parseInt(String(req.query.limit ?? ""), 10) || undefined;
    return res.send(await listFn(userId, { mealIndex, limit }));
  };
}

module.exports = {
  // GET /recent-foods/products?mealIndex=&limit=&userId=
  listProducts: recentList(recentFoodService.listProducts),

  // GET /recent-foods/recipes?mealIndex=&limit=&userId=
  listRecipes: recentList(recentFoodService.listRecipes),

  // POST /recent-foods/hidden
  // body: { mealIndex, kind: "product" | "recipe", ids: string[] } o { mealIndex, kind, all: true }
  async hide(req, res) {
    const input = parseHideInput(req.body, { allowAll: true });
    if (!input) return rejectInvalid(res);
    return res.send(await recentFoodService.hide(req.auth.userId, input));
  },

  // POST /recent-foods/hidden/restore
  // body: { mealIndex, kind, ids: string[] } — deshace una ocultación suelta.
  async restore(req, res) {
    const input = parseHideInput(req.body, { allowAll: false });
    if (!input) return rejectInvalid(res);
    return res.send(await recentFoodService.restore(req.auth.userId, input));
  },
};
