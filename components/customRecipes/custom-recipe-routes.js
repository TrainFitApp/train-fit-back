
const express = require('@awaitjs/express');

const { validateAuth } = require('../../middleware');
const controller = require('./custom-recipe-controller');

const router = express.Router();

router.use(validateAuth);

router.getAsync('/:id', controller.getCustomRecipeById);
router.postAsync('/search', controller.searchCustomRecipes);
router.postAsync('/', controller.createCustomRecipe);
router.putAsync('/:id', controller.update);
router.deleteAsync('/:id', controller.delete);

module.exports = router;
