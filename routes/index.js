const express = require("express");
const products = require("../components/products/product-routes");
const users = require("../components/users/routes");
const diets = require("../components/diets/diet-routes");
const dietDays = require("../components/dietDays/diet-days-routes");
const meals = require("../components/meals/meal-routes");
const customProducts = require("../components/customProducts/custom-product-routes");
const recipes = require("../components/recipes/recipe-routes");
const customRecipes = require("../components/customRecipes/custom-recipe-routes");
const customExercises = require("../components/customExercises/custom-exercise-routes");
const workouts = require("../components/workouts/workout-routes");
const tables = require("../components/tables/table-routes");
const splits = require("../components/splits/split-routes");
const exercises = require("../components/exercises/exercise-routes");
const sets = require("../components/sets/set-routes");
const auth = require("../components/auth/auth-routes");
const logs = require("../components/util/logs-routes");
const billing = require("../components/billing/billing-routes");
const appVersion = require("../components/appVersion/app-version-routes");
const envManager = require("../components/envManager/env-manager-routes");
const serverManager = require("../components/serverManager/server-manager-routes");
const gitManager = require("../components/gitManager/git-manager-routes");
const pinnedExerciseNotes = require("../components/pinnedExerciseNotes/pinned-exercise-note-routes");
const anthropometry = require("../components/anthropometry/anthropometry-routes");
const nutritionalGoals = require("../components/nutritionalGoals/nutritional-goal-routes");
const remoteConfig = require("../components/remoteConfig/remote-config-routes");
const trainerClients = require("../components/trainerClients/trainer-client-routes");
const trainerCheckins = require("../components/trainerCheckins/checkin-routes");
const mealProposalClientRoutes = require("../components/mealProposals/meal-proposal-client-routes");
const nutritionPreferencesClientRoutes = require("../components/nutritionPreferences/nutrition-preferences-client-routes");
const clientCoachViewRoutes = require("../components/clientCoachView/client-coach-view-routes");
const notificationRoutes = require("../components/notifications/notification-routes");
const trainerTaskRoutes = require("../components/trainerTasks/trainer-task-routes");
const dietTemplateRoutes = require("../components/dietTemplates/diet-template-routes");
const mealSnippetRoutes = require("../components/mealSnippets/meal-snippet-routes");
const planAssignmentRoutes = require("../components/planAssignments/plan-assignment-routes");
const routineAssignmentRoutes = require("../components/routineAssignments/routine-assignment-routes");
const workoutTemplateRoutes = require("../components/workoutTemplates/workout-template-routes");
const trainerIntakeConfigRoutes = require("../components/trainerIntakeConfig/trainer-intake-config-routes");
const coachAlertRoutes = require("../components/coachAlerts/coach-alert-routes");
const coachTaskRoutes = require("../components/coachTasks/coach-task-routes");
const clientProgressRoutes = require("../components/clientProgress/client-progress-routes");
const coachRuleRoutes = require("../components/coachRules/coach-rule-routes");
const coachProtocolRoutes = require("../components/coachProtocols/coach-protocol-routes");
const painRoutes = require("../components/painLog/pain-routes");
const supplementRoutes = require("../components/supplements/supplement-routes");
const trainerNutritionalGoalRoutes = require("../components/nutritionalGoals/trainer-nutritional-goal-routes");
const exerciseScoreRoutes = require("../components/exerciseScores/exercise-score-routes");
const clientNotesRoutes = require("../components/clientNotes/client-notes-routes");
const trainerPaymentRoutes = require("../components/trainerPayments/trainer-payment-routes");
const mediaRoutes = require("../components/media/media-routes");
const progressMediaRoutes = require("../components/progressMedia/progress-media-routes");
const formCheckRoutes = require("../components/formChecks/form-check-routes");
const techniqueVideoRoutes = require("../components/techniqueVideos/technique-video-routes");

const router = express.Router();

router.use("/auth", auth);
router.use("/products", products);
router.use("/users", users);
router.use("/diets", diets);
router.use("/dietdays", dietDays);
router.use("/diets", mealProposalClientRoutes);
router.use(nutritionPreferencesClientRoutes);
router.use(clientCoachViewRoutes);
router.use(notificationRoutes);
router.use(trainerTaskRoutes);
// Movimiento 3 Coach Pro — sin prefijo, como trainerTaskRoutes: este
// componente sirve a los DOS lados (el cliente apunta su dolor en /pain/mine,
// el profesional lo lee en /trainer/clients/:id/pain) y sus rutas ya llevan
// escrito el prefijo que le toca a cada una.
router.use(painRoutes);
// Movimiento 5 Coach Pro — misma razón que painRoutes: sirve a los dos lados
// y sus rutas ya llevan escrito el prefijo que le toca a cada una.
router.use(supplementRoutes);
// Fotos y vídeos (docs/plan-medidas-multimedia.md). /media firma subidas y
// sirve el almacenamiento local de desarrollo; el resto van sin prefijo, como
// painRoutes, porque sirven a cliente y profesional.
router.use("/media", mediaRoutes);
router.use(progressMediaRoutes);
router.use(formCheckRoutes);
router.use(techniqueVideoRoutes);
router.use(trainerNutritionalGoalRoutes);
router.use(dietTemplateRoutes);
router.use(mealSnippetRoutes);
router.use(planAssignmentRoutes);
router.use(routineAssignmentRoutes);
router.use(workoutTemplateRoutes);
router.use("/meals", meals);
router.use("/customproducts", customProducts);
router.use("/recipes", recipes);
router.use("/customrecipes", customRecipes);
router.use("/customexercises", customExercises);
router.use("/tables", tables);
router.use("/splits", splits);
router.use("/workouts", workouts);
router.use("/exercises", exercises);
router.use("/sets", sets);
router.use("/logs", logs);
router.use("/billing", billing);
router.use("/pinned-exercise-notes", pinnedExerciseNotes);
router.use("/app", appVersion);
router.use("/env", envManager);
router.use("/server", serverManager);
router.use("/git", gitManager);
router.use("/anthropometry", anthropometry);
router.use("/nutritionalgoals", nutritionalGoals);
router.use("/config", remoteConfig);
router.use("/trainer", trainerClients);
router.use("/trainer", trainerCheckins);
router.use("/trainer", trainerIntakeConfigRoutes);
router.use("/trainer", coachAlertRoutes);
router.use("/trainer", coachTaskRoutes);
router.use("/trainer", clientProgressRoutes);
router.use("/trainer", coachRuleRoutes);
router.use("/trainer", coachProtocolRoutes);
// Movimiento 6 Coach Pro — puntuaciones músculo/articulación por ejercicio.
// Bajo /trainer y sin :clientId: no son de un cliente, son del método del
// profesional.
router.use("/trainer", exerciseScoreRoutes);
// Tab "Notas" de la ficha: todo lo que ha escrito el cliente, con leído por entrenador.
router.use("/trainer", clientNotesRoutes);
// Cobros 2026-09 — /trainer/payments/*: cuota, cobros, pagos registrados,
// vista global y preferencias de avisos (solo el entrenador).
router.use("/trainer", trainerPaymentRoutes);

module.exports = router;
