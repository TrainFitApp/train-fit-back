const coachTaskService = require("./coach-task-service");
const trainerClientService = require("../trainerClients/trainer-client-service");
const { forbidden } = require("../util/http-error");

const MAX_TITLE_LENGTH = 200;
const MAX_NOTES_LENGTH = 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Un clientId en el body no pasa por requireActiveClient (esa ruta no lleva
// :clientId), así que la relación se comprueba aquí explícitamente: sin
// esto, un profesional podría crear tareas apuntando a clientes ajenos y
// leer su nombre en el listado, que viene poblado.
async function resolveClientId(trainerId, rawClientId) {
  if (!rawClientId) return null;
  const block = await trainerClientService.clientWriteBlock(trainerId, rawClientId);
  if (block === "no_relation") throw forbidden("No tienes una relación activa con este cliente", "NO_RELATION");
  if (block === "read_only") throw forbidden("Este cliente está en solo lectura por el cupo de tu plan", "CLIENT_READ_ONLY");
  return rawClientId;
}

function validatePayload({ title, notes, dueDate }) {
  if (title !== undefined) {
    if (typeof title !== "string" || !title.trim()) return "title es obligatorio";
    if (title.trim().length > MAX_TITLE_LENGTH)
      return `title no puede superar ${MAX_TITLE_LENGTH} caracteres`;
  }
  if (notes !== undefined && typeof notes === "string" && notes.length > MAX_NOTES_LENGTH) {
    return `notes no puede superar ${MAX_NOTES_LENGTH} caracteres`;
  }
  if (dueDate !== undefined && dueDate !== null && !ISO_DATE.test(String(dueDate))) {
    return "dueDate debe tener formato YYYY-MM-DD";
  }
  return null;
}

module.exports = {
  // GET /trainer/tasks?status=pending
  async listMine(req, res) {
    const status = ["pending", "done"].includes(req.query.status) ? req.query.status : undefined;
    const tasks = await coachTaskService.listForTrainer(req.auth.userId, { status });
    return res.send(tasks);
  },

  // POST /trainer/tasks — { title, notes?, dueDate?, clientId?, sourceAlertId? }
  async create(req, res) {
    const { title, notes, dueDate, clientId, sourceAlertId } = req.body || {};

    const validationError = validatePayload({ title, notes, dueDate });
    if (validationError) return res.status(400).send({ message: validationError });
    if (title === undefined) return res.status(400).send({ message: "title es obligatorio" });

    const task = await coachTaskService.create(req.auth.userId, {
      title: title.trim(),
      notes: (notes || "").trim(),
      dueDate: dueDate || null,
      clientId: await resolveClientId(req.auth.userId, clientId),
      sourceAlertId: sourceAlertId || null,
    });
    return res.status(201).send(task);
  },

  // PATCH /trainer/tasks/:id — { title?, notes?, dueDate?, status? }
  async update(req, res) {
    const { title, notes, dueDate, status } = req.body || {};

    const validationError = validatePayload({ title, notes, dueDate });
    if (validationError) return res.status(400).send({ message: validationError });
    if (status !== undefined && !["pending", "done"].includes(status)) {
      return res.status(400).send({ message: "status debe ser pending o done" });
    }

    const updates = {};
    if (title !== undefined) updates.title = title.trim();
    if (notes !== undefined) updates.notes = (notes || "").trim();
    if (dueDate !== undefined) updates.dueDate = dueDate || null;
    if (status !== undefined) {
      updates.status = status;
      updates.completedAt = status === "done" ? new Date() : null;
    }

    const task = await coachTaskService.update(req.auth.userId, req.params.id, updates);
    if (!task) return res.status(404).send({ message: "Tarea no encontrada" });
    return res.send(task);
  },

  // DELETE /trainer/tasks/:id
  async remove(req, res) {
    const task = await coachTaskService.remove(req.auth.userId, req.params.id);
    if (!task) return res.status(404).send({ message: "Tarea no encontrada" });
    return res.sendStatus(204);
  },
};
