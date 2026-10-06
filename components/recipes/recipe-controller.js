const recipeService = require("./recipe-service");

const isAdmin = (req) => Boolean(req.userData?.roles?.includes("admin"));
const isTrainer = (req) => Boolean(req.userData?.roles?.includes("trainer"));

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return !!value;
}

const toInt = (value, fallback) => parseInt(String(value ?? fallback), 10);

// Tags como array (?tags=a&tags=b) o CSV (?tags=a,b).
function parseTags(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : String(raw).split(",");
  return list.map((t) => String(t).trim()).filter(Boolean);
}

module.exports = {
  async getRecipeById(req, res) {
    res.json(await recipeService.getReadableRecipe(req.params.id, req.user.id, isAdmin(req)));
  },

  async searchRecipes(req, res) {
    const input = { ...(req.body || {}), ...req.query };
    const filters = {
      ownOnly: toBoolean(input.own),
      favoritesOnly: toBoolean(input.fav),
      verifiedOnly: toBoolean(input.verified),
      tags: parseTags(input.tags),
    };
    res.json(
      await recipeService.searchRecipes(toInt(req.query.page, 0), toInt(req.query.limit, 10), input.search || "", req.user.id, filters),
    );
  },

  async getUserRecipes(req, res) {
    res.json(
      await recipeService.getUserRecipes(req.user.id, toInt(req.query.page, 0), toInt(req.query.limit, 20), req.query.search || ""),
    );
  },

  async getVerifiedRecipes(req, res) {
    res.json(await recipeService.getVerifiedRecipes(toInt(req.query.page, 0), toInt(req.query.limit, 20), req.query.search || ""));
  },

  async createRecipe(req, res) {
    const { name, description, customProducts, tags, verified } = req.body;
    const recipe = await recipeService.createOwnRecipe(
      req.user,
      { name, description, customProducts, tags: parseTags(tags), verified },
      { isAdmin: isAdmin(req) },
    );
    res.status(201).json(recipe);
  },

  async composeRecipe(req, res) {
    const result = await recipeService.composeForUser(req.user, req.body, { isAdmin: isAdmin(req), isTrainer: isTrainer(req) });
    res.status(201).json(result);
  },

  async updateRecipe(req, res) {
    const changes = {};
    for (const field of ["name", "description", "customProducts"]) {
      if (req.body[field] !== undefined) changes[field] = req.body[field];
    }
    if (req.body.tags !== undefined) changes.tags = parseTags(req.body.tags);
    res.json(await recipeService.updateOwnRecipe(req.params.id, req.user.id, isAdmin(req), changes));
  },

  async deleteRecipe(req, res) {
    await recipeService.deleteOwnRecipe(req.params.id, req.user.id, isAdmin(req));
    res.json({ message: "Recipe deleted successfully" });
  },

  async removeRecipeCustomProduct(req, res) {
    res.json(
      await recipeService.removeRecipeCustomProduct(req.params.idRecipe, req.params.idCustomProduct, req.user.id, isAdmin(req)),
    );
  },
};
