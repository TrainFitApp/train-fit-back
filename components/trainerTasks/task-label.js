const ETIQUETAS_PRESET = {
  steps: "Pasos diarios",
  water: "Agua",
  sleep: "Horas de sueño",
};

// Tipos de hábito diario: los predefinidos y uno con nombre propio. Única
// lista para el schema de TrainerTask, los hábitos de CoachProtocol y la
// validación de ambos controllers. El cardio no es un hábito: se pauta y se
// registra en el entrenamiento (2026-10-09; paso 28 de `npm run migrate`).
const TASK_TYPES = [...Object.keys(ETIQUETAS_PRESET), "custom"];

/**
 * Nombre legible de un hábito. Vivía duplicado en trainer-task-controller y
 * se volvió a copiar al desglosar la adherencia: la Cartera llegó a mostrar
 * "steps" donde la ficha decía "Pasos diarios".
 */
function taskLabel(task) {
  if (!task) return "Tarea";
  if (task.type === "custom") return task.label || "Tarea";
  return task.label || ETIQUETAS_PRESET[task.type] || "Tarea";
}

module.exports = { taskLabel, ETIQUETAS_PRESET, TASK_TYPES };
