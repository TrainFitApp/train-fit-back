const planAssignmentDao = require("./plan-assignment-dao");
const dietTemplateService = require("../dietTemplates/diet-template-service");

// Solo modo secuencial (funcionalidad 6): para una fecha dada, el día de la
// plantilla que toca es determinista — días transcurridos desde `startDate`,
// módulo nº de días de la plantilla. Sin lógica de patrones por día de
// semana ni generación de propuestas.
function daysBetween(startDate, targetDate) {
  const start = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate());
  const target = Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate());
  return Math.floor((target - start) / (1000 * 60 * 60 * 24));
}

function isWithinPeriod(period, targetDate) {
  const start = new Date(period.startDate);
  if (targetDate < start) return false;

  if (period.endMode === "indefinite") return true;
  if (period.endMode === "fixedDate") {
    return targetDate <= new Date(period.endDate);
  }
  if (period.endMode === "duration") {
    const elapsed = daysBetween(start, targetDate);
    return elapsed < (period.durationDays || 0);
  }
  return false;
}

module.exports = {
  // Devuelve los ids de Meal (clonados, listos para usar) del día de
  // secuencia que corresponde a `dateString` para este cliente, o null si no
  // hay ningún plan activo vigente esa fecha (el llamador cae al
  // comportamiento estándar existente).
  async resolveTemplateMealsForDate(clientId, dateString) {
    const assignment = await planAssignmentDao.findActiveByClient(clientId);
    if (!assignment || !assignment.planId) return null;

    const targetDate = new Date(dateString);
    if (Number.isNaN(targetDate.getTime())) return null;
    if (!isWithinPeriod(assignment.period, targetDate)) return null;

    const template = assignment.planId;
    if (!template.days || template.days.length === 0) return null;

    const elapsed = daysBetween(new Date(assignment.period.startDate), targetDate);
    if (elapsed < 0) return null;

    const dayIndex = elapsed % template.days.length;
    const day = template.days[dayIndex];
    if (!day || !day.meals || day.meals.length === 0) return null;

    const clonedMealIds = [];
    for (const mealId of day.meals) {
      clonedMealIds.push(await dietTemplateService.cloneMealDeep(mealId));
    }
    return clonedMealIds;
  },
};
