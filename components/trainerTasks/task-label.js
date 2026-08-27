const ETIQUETAS_PRESET = {
  steps: "Pasos diarios",
  water: "Agua",
  sleep: "Horas de sueño",
  cardio: "Cardio",
};

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

module.exports = { taskLabel, ETIQUETAS_PRESET };
