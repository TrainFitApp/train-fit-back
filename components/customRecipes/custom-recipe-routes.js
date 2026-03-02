
const express = require('@awaitjs/express');

const { auth } = require('../../middleware/validateAuth');
const controller = require('./custom-recipe-controller');
const ROLES = require('../users/util/roles');

const router = express.Router();

router.getAsync('/:id', controller.getCustomRecipeById);
router.postAsync('/search', controller.searchCustomRecipes);
router.postAsync('/', controller.createCustomRecipe);
router.postAsync('/new/:idUser/:idMeal', controller.createNewCustomRecipe);
router.putAsync('/', controller.update);
router.putAsync('/:idCustomRecipe', controller.addCustomRecipeCustomProduct);
// router.deleteAsync('/:idCustomRecipe/:idCustomProduct', controller.deleteCustomRecipeCustomProduct);
router.deleteAsync('/:id', controller.delete);

module.exports = router;
