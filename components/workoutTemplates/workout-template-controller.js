const workoutTemplateService = require("./workout-template-service");

const LEVELS = new Set(["principiante", "intermedio", "avanzado"]);
const BLOCK_TYPES = new Set(["straight", "superset", "circuit", "warmup", "finisher"]);
const MAX_TAGS = 10;
const MAX_EQUIPMENT = 10;
const MAX_TAG_LENGTH = 30;

function sanitizeStringArray(value, max, maxLen) {
  return (Array.isArray(value) ? value : [])
    .map((v) => (v || "").toString().trim().slice(0, maxLen))
    .filter(Boolean)
    .slice(0, max);
}

function sanitizeLevel(level) {
  return LEVELS.has(level) ? level : "intermedio";
}

function toFiniteOrNull(value) {
  // Number(null) === 0 y Number("") === 0 — hay que descartar "sin valor"
  // ANTES de convertir, si no un restPause/rounds ausente se guardaría como 0.
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function sanitizeSets(sets) {
  return (Array.isArray(sets) ? sets : []).map((set) => ({
    expectedReps: Array.isArray(set?.expectedReps)
      ? set.expectedReps.map(Number).filter(Number.isFinite)
      : [],
    expectedRir: Array.isArray(set?.expectedRir)
      ? set.expectedRir.map(Number).filter(Number.isFinite)
      : [],
    drop: Boolean(set?.drop),
    restPause: toFiniteOrNull(set?.restPause),
    expectedTime: (set?.expectedTime || "").toString().trim().slice(0, 20),
    expectedDistance: toFiniteOrNull(set?.expectedDistance),
  }));
}

// Requiere ex.exercise (ref a Exercise) — un ejercicio de plantilla sin
// referencia real no tiene sentido y se descarta en vez de guardarse roto.
function sanitizeExercises(exercises) {
  return (Array.isArray(exercises) ? exercises : [])
    .filter((ex) => ex?.exercise)
    .map((ex, index) => ({
      exercise: ex.exercise,
      order: Number.isFinite(Number(ex.order)) ? Number(ex.order) : index,
      notes: (ex.notes || "").toString().trim().slice(0, 500),
      sets: sanitizeSets(ex.sets),
    }));
}

function sanitizeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map((block, index) => ({
    name: (block?.name || "").toString().trim().slice(0, 100),
    type: BLOCK_TYPES.has(block?.type) ? block.type : "straight",
    order: Number.isFinite(Number(block?.order)) ? Number(block.order) : index,
    rounds: toFiniteOrNull(block?.rounds),
    restBetweenExercises: toFiniteOrNull(block?.restBetweenExercises),
    restBetweenRounds: toFiniteOrNull(block?.restBetweenRounds),
    instructions: (block?.instructions || "").toString().trim().slice(0, 500),
    exercises: sanitizeExercises(block?.exercises),
  }));
}

function buildPatchFromBody(body) {
  const patch = {};
  if (body?.description !== undefined) {
    patch.description = (body.description || "").toString().trim().slice(0, 500);
  }
  if (body?.level !== undefined) patch.level = sanitizeLevel(body.level);
  if (body?.tags !== undefined) patch.tags = sanitizeStringArray(body.tags, MAX_TAGS, MAX_TAG_LENGTH);
  if (body?.equipment !== undefined) {
    patch.equipment = sanitizeStringArray(body.equipment, MAX_EQUIPMENT, MAX_TAG_LENGTH);
  }
  if (body?.blocks !== undefined) patch.blocks = sanitizeBlocks(body.blocks);
  return patch;
}

module.exports = {
  // Funciones puras exportadas para test (workout-template-controller.test.js)
  // — mismo criterio que assertMealEditable en meal-service.js.
  sanitizeLevel,
  sanitizeSets,
  sanitizeExercises,
  sanitizeBlocks,

  // --- Biblioteca de plantillas propias del profesional ---
  async createTemplate(req, res) {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });

    const template = await workoutTemplateService.create(req.auth.userId, {
      name,
      ...buildPatchFromBody(req.body),
    });
    return res.status(201).send(template);
  },

  async listTemplates(req, res) {
    const templates = await workoutTemplateService.listByTrainer(req.auth.userId);
    return res.send(templates);
  },

  async updateTemplate(req, res) {
    const existing = await workoutTemplateService.findOwned(req.auth.userId, req.params.id);
    if (!existing) return res.status(404).send({ message: "Plantilla no encontrada" });

    const patch = buildPatchFromBody(req.body);
    if (req.body?.name !== undefined) {
      const name = (req.body.name || "").trim();
      if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });
      patch.name = name;
    }

    const template = await workoutTemplateService.update(req.auth.userId, req.params.id, patch);
    return res.send(template);
  },

  async deleteTemplate(req, res) {
    if (!(await workoutTemplateService.remove(req.auth.userId, req.params.id))) {
      return res.status(404).send({ message: "Plantilla no encontrada" });
    }
    return res.sendStatus(204);
  },

  // POST /trainer/clients/:clientId/splits/:splitId/workout-templates/:templateId/apply
  async applyTemplateToSplit(req, res) {
    const template = await workoutTemplateService.findOwned(req.auth.userId, req.params.templateId);
    if (!template) return res.status(404).send({ message: "Plantilla no encontrada" });

    // Mismo shape que el resto de altas de workout (addWorkoutsToSplits):
    // devuelve table.splits completo, no solo el Workout creado.
    const splits = await workoutTemplateService.applyToSplit(template, req.params.splitId, req.params.clientId);
    return res.status(201).send(splits);
  },

  // POST /trainer/workouts/:workoutId/save-as-template — inverso de aplicar:
  // un Workout ya construido en mesocycle.page.ts se guarda como plantilla
  // reutilizable.
  async saveWorkoutAsTemplate(req, res) {
    const name = (req.body?.name || "").trim();
    if (!name) return res.status(400).send({ message: "El nombre es obligatorio" });

    const template = await workoutTemplateService.saveWorkoutAsTemplate(req.auth.userId, req.params.workoutId, {
      name,
      ...buildPatchFromBody(req.body),
    });
    return res.status(201).send(template);
  },
};
