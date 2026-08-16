const workoutTemplateService = require("./workout-template-service");

function handleServiceError(res, error) {
  if (error.statusCode) {
    return res.status(error.statusCode).send({
      message: error.message,
      code: error.code,
    });
  }
  console.error("[WORKOUT_TEMPLATES] unexpected_error", error);
  return res.status(500).send({ message: "Error interno del servidor" });
}

module.exports = {
  async createFromClient(req, res) {
    try {
      const template = await workoutTemplateService.createFromClient(req.user.id, {
        clientId: req.body?.clientId,
        workoutId: req.body?.workoutId,
        name: req.body?.name,
        tags: req.body?.tags,
        equipment: req.body?.equipment,
      });
      return res.status(201).send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async getClientActiveTable(req, res) {
    try {
      const table = await workoutTemplateService.getClientActiveTable(
        req.user.id,
        req.params.clientId
      );
      return res.send(table);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async list(req, res) {
    const templates = await workoutTemplateService.listMyTemplates(
      req.user.id,
      req.query.search
    );
    return res.send(templates);
  },

  async getById(req, res) {
    try {
      const template = await workoutTemplateService.getMyTemplate(req.user.id, req.params.id);
      return res.send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async remove(req, res) {
    try {
      await workoutTemplateService.deleteMyTemplate(req.user.id, req.params.id);
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async applyToClient(req, res) {
    try {
      const table = await workoutTemplateService.applyToClient(
        req.user.id,
        req.params.clientId,
        req.params.id
      );
      return res.status(201).send(table);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Builder: rutina de un cliente ---

  async createClientTable(req, res) {
    try {
      const table = await workoutTemplateService.createClientTable(
        req.user.id,
        req.params.clientId,
        req.body?.name
      );
      return res.status(201).send(table);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addSplit(req, res) {
    try {
      const result = await workoutTemplateService.addSplit(
        req.user.id,
        req.params.clientId,
        req.params.tableId,
        req.body?.name
      );
      return res.status(201).send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addWorkoutRow(req, res) {
    try {
      const result = await workoutTemplateService.addWorkoutRow(
        req.user.id,
        req.params.clientId,
        req.params.tableId,
        req.body?.name
      );
      return res.status(201).send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async renameWorkoutRow(req, res) {
    try {
      await workoutTemplateService.renameWorkoutRow(
        req.user.id,
        req.params.clientId,
        req.params.tableId,
        req.params.workoutId,
        req.body?.name
      );
      return res.send({ renamed: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async reorderWorkoutRows(req, res) {
    try {
      const result = await workoutTemplateService.reorderWorkoutRows(
        req.user.id,
        req.params.clientId,
        req.params.tableId,
        req.body?.workoutIdsOrder
      );
      return res.send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async deleteWorkoutRow(req, res) {
    try {
      await workoutTemplateService.deleteWorkoutRow(
        req.user.id,
        req.params.clientId,
        req.params.tableId,
        req.params.workoutId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Builder: ejercicios/series sobre el workout de un CLIENTE ---

  async addClientExercise(req, res) {
    try {
      const result = await workoutTemplateService.addExercise(
        req.user.id,
        { clientId: req.params.clientId },
        req.params.workoutId,
        { exerciseId: req.body?.exerciseId, notes: req.body?.notes }
      );
      return res.status(201).send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async deleteClientExercise(req, res) {
    try {
      await workoutTemplateService.deleteExercise(
        req.user.id,
        { clientId: req.params.clientId },
        req.params.workoutId,
        req.params.customExerciseId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addClientSet(req, res) {
    try {
      const result = await workoutTemplateService.addSet(
        req.user.id,
        { clientId: req.params.clientId },
        req.params.workoutId,
        req.params.customExerciseId,
        req.body
      );
      return res.status(201).send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async updateClientSet(req, res) {
    try {
      const result = await workoutTemplateService.updateSet(
        req.user.id,
        { clientId: req.params.clientId },
        req.params.workoutId,
        req.params.customExerciseId,
        req.params.setId,
        req.body
      );
      return res.send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async deleteClientSet(req, res) {
    try {
      await workoutTemplateService.deleteSet(
        req.user.id,
        { clientId: req.params.clientId },
        req.params.workoutId,
        req.params.customExerciseId,
        req.params.setId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  // --- Builder: plantilla desde cero + ejercicios/series de una plantilla ---

  async createTemplateFromScratch(req, res) {
    try {
      const template = await workoutTemplateService.createTemplateFromScratch(req.user.id, {
        name: req.body?.name,
        tags: req.body?.tags,
        equipment: req.body?.equipment,
      });
      return res.status(201).send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async updateTemplateMetadata(req, res) {
    try {
      const template = await workoutTemplateService.updateTemplateMetadata(req.user.id, req.params.id, {
        name: req.body?.name,
        tags: req.body?.tags,
        equipment: req.body?.equipment,
      });
      return res.send(template);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addTemplateExercise(req, res) {
    try {
      const result = await workoutTemplateService.addExercise(
        req.user.id,
        { templateId: req.params.id },
        req.params.id,
        { exerciseId: req.body?.exerciseId, notes: req.body?.notes }
      );
      return res.status(201).send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async deleteTemplateExercise(req, res) {
    try {
      await workoutTemplateService.deleteExercise(
        req.user.id,
        { templateId: req.params.id },
        req.params.id,
        req.params.customExerciseId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async addTemplateSet(req, res) {
    try {
      const result = await workoutTemplateService.addSet(
        req.user.id,
        { templateId: req.params.id },
        req.params.id,
        req.params.customExerciseId,
        req.body
      );
      return res.status(201).send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async updateTemplateSet(req, res) {
    try {
      const result = await workoutTemplateService.updateSet(
        req.user.id,
        { templateId: req.params.id },
        req.params.id,
        req.params.customExerciseId,
        req.params.setId,
        req.body
      );
      return res.send(result);
    } catch (error) {
      return handleServiceError(res, error);
    }
  },

  async deleteTemplateSet(req, res) {
    try {
      await workoutTemplateService.deleteSet(
        req.user.id,
        { templateId: req.params.id },
        req.params.id,
        req.params.customExerciseId,
        req.params.setId
      );
      return res.send({ deleted: true });
    } catch (error) {
      return handleServiceError(res, error);
    }
  },
};
