// PURO — "Tus planes" del tab Coach del cliente: el plan de hoy
// (current-plans.js), los programados y los anteriores, de rutina y de dieta.
// Sin BD: el servicio le pasa las fases ya leídas y luego pone los nombres.
//
// Cada lista sale en el orden en que se lee: las programadas de la más
// próxima a la más lejana y las anteriores de la más reciente a la más
// antigua. Una fase sustituida el mismo día en que empezaba no llegó a regir
// (manda la más reciente, util/phase-chain.js) y no sale.

const { sortChain, cutEndDate } = require("../util/phase-chain");

const idOf = (value) => (value == null ? null : String(value));

// La cadena sin las fases que no llegaron a regir.
function ruledChain(phases) {
  const ordered = sortChain(phases);
  return ordered.filter((phase, index) => ordered[index + 1]?.startDate !== phase.startDate);
}

// Reparte la cadena (sin la fase del plan de hoy) en programadas y anteriores.
function splitChain(chain, currentId, today) {
  const rest = chain.filter((phase) => idOf(phase._id) !== currentId);
  return {
    upcoming: rest.filter((phase) => phase.startDate > today),
    past: rest.filter((phase) => phase.startDate <= today).reverse(),
  };
}

/**
 * Rutina. `phases`: RoutineAssignment del cliente. `current`: el plan de hoy
 * ({status, tableId, startDate} de pickTrainingPlan, ya filtrado por
 * profesional activo) o null. Una fase de rutina no guarda su fin: acaba la
 * víspera de la siguiente (null si no hay siguiente).
 */
function trainingTimeline({ phases = [], current = null, today }) {
  const chain = ruledChain(phases);
  const endOf = new Map(
    chain.map((phase, index) => [idOf(phase._id), chain[index + 1] ? cutEndDate(phase, chain[index + 1].startDate) : null])
  );
  const entry = (phase) => ({
    id: idOf(phase._id),
    tableId: idOf(phase.tableId),
    trainerId: idOf(phase.trainerId),
    startDate: phase.startDate,
    endDate: endOf.get(idOf(phase._id)),
  });

  // La rutina de hoy puede no venir de ninguna fase (asignada o puesta en
  // uso sin programar): entonces no tiene fin y la fecha la pone el servicio.
  const currentPhase = current?.startDate
    ? chain.find((phase) => idOf(phase.tableId) === idOf(current.tableId) && phase.startDate === current.startDate)
    : null;
  const { upcoming, past } = splitChain(chain, idOf(currentPhase?._id), today);

  return {
    current: current
      ? currentPhase
        ? { status: current.status, ...entry(currentPhase) }
        : { status: current.status, id: null, tableId: idOf(current.tableId), trainerId: null, startDate: current.startDate || null, endDate: null }
      : null,
    upcoming: upcoming.map(entry),
    past: past.map(entry),
  };
}

/**
 * Dieta. `phases`: DietPhase del cliente (con su fin real, null mientras
 * sigue). `current`: {status, phase} de pickNutritionPlan, ya filtrado por
 * profesional activo, o null.
 */
function nutritionTimeline({ phases = [], current = null, today }) {
  const chain = ruledChain(phases);
  const entry = (phase) => ({
    id: idOf(phase._id),
    name: phase.name,
    trainerId: idOf(phase.trainerId),
    startDate: phase.startDate,
    endDate: phase.endDate || null,
    kcal: Number.isFinite(phase.target?.kcal) ? Math.round(phase.target.kcal) : null,
  });
  const { upcoming, past } = splitChain(chain, idOf(current?.phase?._id), today);

  return {
    current: current ? { status: current.status, ...entry(current.phase) } : null,
    upcoming: upcoming.map(entry),
    past: past.map(entry),
  };
}

module.exports = { trainingTimeline, nutritionTimeline };
