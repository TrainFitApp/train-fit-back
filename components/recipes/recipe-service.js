const recipeDao = require("./recipe-dao");
const trainerClientDao = require("../trainerClients/trainer-client-dao");

module.exports = {
  async countByUserId(userId) {
    return recipeDao.countByUserId(userId);
  },

  async getRecipeById(id) {
    return recipeDao.getRecipeById(id);
  },

  async createRecipe(recipe) {
    return recipeDao.createRecipe(recipe);
  },

  async updateRecipe(id, recipe) {
    return recipeDao.updateRecipe(id, recipe);
  },

  async deleteRecipe(id) {
    return recipeDao.deleteRecipe(id);
  },

  async searchRecipes(page, limit, search, userId, filters) {
    return recipeDao.searchRecipes(page, limit, search, userId, filters);
  },

  async getUserRecipes(userId, page, limit) {
    return recipeDao.getUserRecipes(userId, page, limit);
  },

  async getVerifiedRecipes(page, limit, search) {
    return recipeDao.getVerifiedRecipes(page, limit, search);
  },

  async getArchivedRecipes(userId, page, limit, search) {
    return recipeDao.getArchivedRecipes(userId, page, limit, search);
  },

  async toggleArchivedRecipe(userId, recipeId) {
    return recipeDao.toggleArchivedRecipe(userId, recipeId);
  },

  async addRecipeCustomProduct(idRecipe, idCustomProduct) {
    return recipeDao.addRecipeCustomProduct(idRecipe, idCustomProduct);
  },

  async removeRecipeCustomProduct(idRecipe, idCustomProduct) {
    return recipeDao.removeRecipeCustomProduct(idRecipe, idCustomProduct);
  },

  async composeRecipe(payload, userId, isAdmin = false) {
    return recipeDao.composeRecipe(payload, userId, isAdmin);
  },

  // ¿Puede `userId` leer esta receta? Las verificadas (y las globales sin
  // dueño) las ve todo el mundo; las privadas, su dueño, su entrenador o su
  // cliente (relación activa en cualquier sentido: el cliente abre la receta
  // que le pautó su entrenador y el entrenador las de su cliente), y quien
  // ya la tiene en favoritas o en su diario. El admin pasa antes.
  async canUserReadRecipe(recipe, userId) {
    if (!recipe) return false;
    if (recipe.verified || !recipe.userId) return true;
    const ownerId = String(recipe.userId);
    if (ownerId === String(userId)) return true;
    const [asTrainer, asClient] = await Promise.all([
      trainerClientDao.findActiveRelationsOfPair(ownerId, userId),
      trainerClientDao.findActiveRelationsOfPair(userId, ownerId),
    ]);
    if (asTrainer.length || asClient.length) return true;
    if (await recipeDao.isRecipeArchivedByUser(recipe._id, userId)) return true;
    return recipeDao.isRecipeInUserDiary(recipe._id, userId);
  },
};
