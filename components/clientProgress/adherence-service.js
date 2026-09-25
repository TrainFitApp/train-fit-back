
// Fase 2 Coach Pro — adherencia MULTIDIMENSIONAL.
//
// El sistema tenía un solo número llamado "adherencia" (¿la comida pautada
// cuadraba con el objetivo de kcal?) que ni siquiera medía lo que su nombre
// promete. Aquí se separan las cuatro dimensiones que el coach puede
// realmente accionar por separado, porque la respuesta a "¿qué le digo a
// este cliente?" es distinta en cada una:
//
//   nutrición    -> ¿se come lo que le pauté?          (DietDay + items marcados)
//   entrenamiento-> ¿entrena las sesiones prescritas?  (Workout con fecha)
//   hábitos      -> ¿cumple pasos/agua/sueño?          (TaskCompletion)
//   check-ins    -> ¿me reporta?                       (CheckinResponse vs cadencia)
//
// Todo aquí es puro: entran datos ya cargados, sale el desglose. Sin
// require de modelos, sin await. Ver client-progress-controller.js para la
// carga.

// Una dimensión con menos días de datos que esto no se reporta: un
// porcentaje sobre 2 días no es una señal, es ruido — y el coach tomaría
// decisiones sobre él igual que sobre uno sólido.
const MIN_DAYS_FOR_SIGNAL = 3;

function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 100);
}

/**
 * Nutrición: media del % de items pautados que el cliente marcó, sobre los
 * días QUE TENÍAN PLAN. Se recibe ya calculado por
 * dietDaysNutritionUtil.computeRangeAdherence — no se reimplementa aquí.
 */
function nutritionDimension(rangeAdherence) {
  if (!rangeAdherence || rangeAdherence.daysWithData < MIN_DAYS_FOR_SIGNAL) {
    // Auditoría 2026-09 — bug real visto en BD: un cliente CON plan de dieta
    // activo (recién asignado, sin contenido configurado, o modo "choice" sin
    // elegir todavía) decía "sin_datos" exactamente igual que un cliente SIN
    // ningún plan. El frontend apañaba la diferencia añadiendo "— plan
    // asignado: X" al texto, pero "sin datos suficientes" junto a un plan
    // real leía como contradicción (mismo tipo de bug que sin_plan/
    // sin_sesiones_en_ventana en trainingDimension). hasActivePlan distingue
    // los dos casos de verdad.
    return {
      applicable: false,
      reason: rangeAdherence?.hasActivePlan ? "sin_datos" : "sin_plan_nutricion",
    };
  }
  return {
    applicable: true,
    percentage: rangeAdherence.percentage,
    detail: `${rangeAdherence.daysWithData} de ${rangeAdherence.periodDays} días con plan`,
    daysWithData: rangeAdherence.daysWithData,
  };
}

/**
 * Entrenamiento: sesiones hechas frente a las que tiene el PLAN.
 *
 * Un microciclo se mide en sesiones, no en días: `Split` no guarda duración
 * y no hay forma de saber si el suyo es de una semana o de diez días. La
 * versión anterior cogía el último microciclo, asumía que duraba 7 días y lo
 * extrapolaba a las semanas del periodo — con 2 microciclos de 2 sesiones
 * decía "8 esperadas" porque multiplicaba 2 × 4 semanas, no porque el plan
 * tuviera 8.
 *
 * Ahora se compara contra el plan entero: 3 de 4 sesiones hechas es 75%,
 * dure lo que dure. Sin plan asignado la dimensión no aplica.
 */
function trainingDimension({ completedSessions, plannedTotal, scheduledDays }) {
  // Auditoría 2026-09 — scheduledDays cuenta TODOS los días proyectados de
  // la ventana (entreno + descanso); plannedTotal excluye los de descanso a
  // propósito. Sin scheduledDays no se podía distinguir "no hay ninguna
  // fase/tabla" de "hay fase, pero en esta ventana tan corta solo tocaba
  // descanso" — visto en BD: una fase que empieza HOY cuyo primer día es de
  // descanso planificado salía como "sin fase en curso", siendo mentira.
  if (!scheduledDays) {
    return { applicable: false, reason: "sin_plan" };
  }
  if (!plannedTotal) {
    return { applicable: false, reason: "sin_sesiones_en_ventana" };
  }
  return {
    applicable: true,
    percentage: Math.min(100, pct(completedSessions, plannedTotal) ?? 0),
    detail: `${completedSessions} de ${plannedTotal} sesiones del plan`,
    completedSessions,
    plannedTotal,
  };
}

/**
 * Hábitos: UNA dimensión, con el desglose de cada hábito dentro.
 *
 * Antes era un agregado ciego —marcas totales / (tareas × 28 días)— con dos
 * problemas: la ventana de 28 días estaba fija aunque el hábito llevara
 * activo tres, y un solo número no decía CUÁL se estaba incumpliendo.
 *
 * Ahora cada hábito se mide contra sus propios días activos (desde que se
 * creó, topado al periodo que se esté mirando) y la dimensión es la media de
 * los hábitos, no de las marcas. Así un hábito recién puesto no hunde la
 * nota por los días en que todavía no existía, y pesa igual que los demás
 * aunque lleve menos tiempo.
 *
 * Sigue siendo UNA dimensión a propósito: si cada hábito entrara por su
 * cuenta en la media global, un cliente con seis hábitos y una dieta tendría
 * la nota decidida por los hábitos casi en solitario.
 *
 * @param habits [{ id, label, completions, activeDays }]
 */
function habitsDimension({ habits }) {
  const medibles = (habits || []).filter((habit) => habit.activeDays > 0);
  if (!medibles.length) {
    return { applicable: false, reason: "sin_tareas" };
  }

  const breakdown = medibles.map((habit) => ({
    id: habit.id,
    label: habit.label,
    target: habit.target ?? null,
    unit: habit.unit || "",
    percentage: Math.min(100, pct(habit.completions, habit.activeDays) ?? 0),
    completions: habit.completions,
    activeDays: habit.activeDays,
    detail: `${habit.completions} de ${habit.activeDays} días`,
  }));

  const media = Math.round(
    breakdown.reduce((acc, habit) => acc + habit.percentage, 0) / breakdown.length
  );

  return {
    applicable: true,
    percentage: media,
    detail: breakdown.length === 1 ? breakdown[0].detail : `${breakdown.length} hábitos`,
    breakdown,
  };
}

/**
 * Check-ins: SOLICITUDES RESPONDIDAS frente a las que se pidieron.
 *
 * Ya no hay cadencias que estimar: las solicitudes son fechas concretas de
 * la programación del cliente (docs/plan-semanas.md), así que el
 * denominador son las que ya han llegado en el periodo — ni una más.
 *
 * Contar respuestas sueltas daba dos resultados malos a la vez: un "7 de 4"
 * que se lee como un error de cuentas, y un 100% para quien mandó siete
 * respuestas la misma semana y dejó tres solicitudes en blanco. Con una
 * respuesta por solicitud, eso ya no puede pasar.
 */
function checkinsDimension({ expected = 0, answered = 0 } = {}) {
  if (!expected) {
    return { applicable: false, reason: "sin_checkins" };
  }
  return {
    applicable: true,
    percentage: Math.min(100, pct(answered, expected) ?? 0),
    detail: `${answered} de ${expected} check-ins respondidos`,
  };
}

/**
 * Global: media de las dimensiones QUE APLICAN, nunca de las cuatro fijas.
 *
 * Es la diferencia entre un número útil y uno que miente: un cliente solo de
 * nutrición no tiene entrenamiento, hábitos ni check-ins que medir, y
 * promediar cuatro dimensiones contando esas tres como 0 lo dejaría en un
 * 25% que no significa nada. También se devuelve `weakest` — el punto
 * concreto donde está fallando — porque una media sola vuelve a esconder
 * exactamente lo que hay que ver.
 */
function computeAdherence(input) {
  const dimensions = {
    nutrition: nutritionDimension(input.nutrition),
    training: trainingDimension(input.training || {}),
    habits: habitsDimension(input.habits || {}),
    checkins: checkinsDimension(input.checkins || {}),
  };

  const applicable = Object.entries(dimensions).filter(([, d]) => d.applicable);

  const overall = applicable.length
    ? Math.round(applicable.reduce((acc, [, d]) => acc + d.percentage, 0) / applicable.length)
    : null;

  const weakest = applicable.length
    ? applicable.reduce((worst, entry) => (entry[1].percentage < worst[1].percentage ? entry : worst))[0]
    : null;

  return {
    overall,
    weakest,
    applicableCount: applicable.length,
    dimensions,
  };
}

module.exports = {
  computeAdherence,
  // Exportadas para test unitario — cada dimensión tiene su propio criterio
  // de "no aplica", que es donde están los errores de esta clase de código.
  nutritionDimension,
  trainingDimension,
  habitsDimension,
  checkinsDimension,
};
