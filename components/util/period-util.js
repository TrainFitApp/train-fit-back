// Extraído de planAssignments/plan-assignment-service.js — lógica de
// "fecha de fin de un periodo" (PlanAssignment) separada del servicio para
// poder testearla de forma aislada.
function addDaysToIsoDate(isoDate, deltaDays) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function computeEndDate(startDate, endMode, { fixedEndDate, durationValue, durationUnit } = {}) {
  if (endMode === "indefinite") return null;
  if (endMode === "fixedDate") return fixedEndDate;
  if (endMode === "duration") {
    const days = durationUnit === "weeks" ? Number(durationValue) * 7 : Number(durationValue);
    return addDaysToIsoDate(startDate, days - 1); // inclusive: "2 semanas" = 14 días, el último incluido
  }
  throw new Error(`endMode desconocido: ${endMode}`);
}

module.exports = { addDaysToIsoDate, computeEndDate };
