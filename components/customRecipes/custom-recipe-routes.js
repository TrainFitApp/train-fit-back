
const express = require('@awaitjs/express');

const { validateAuth, auth } = require('../../middleware');
const controller = require('./custom-recipe-controller');

const router = express.Router();

router.use(validateAuth);

router.getAsync('/:id', controller.getCustomRecipeById);
// Búsqueda global (recetas-instancia de todos los diarios): solo admin.
router.postAsync('/search', auth(['admin']), controller.searchCustomRecipes);
router.postAsync('/', controller.createCustomRecipe);
router.putAsync('/:id', controller.update);
router.deleteAsync('/:id', controller.delete);

module.exports = router;
