const {
  CHECKIN_FIELDS,
  isPlausibleAnthropometry,
  isPlausibleAnthropometryChange,
} = require("../trainerCheckins/checkin-field-catalog");
const { isCheckinDue, checkinOverdueCycles } = require("../trainerCheckins/checkin-due");

// Fase 1 Coach Pro — el CÁLCULO de las señales, separado de dónde salen los
// datos y de dónde se escriben las alertas (eso es coach-alert-service.js).
// Todo aquí es puro: entra un objeto con los datos ya cargados, sale una
// lista de señales. Sin `require` de modelos, sin await, sin Date.now()
// implícito (`now` siempre se pasa). Así se prueba entero sin BD ni mocks —
// mismo criterio que findDueReminders en checkin-reminder-service.js.

// --- Umbrales ---
// Fase 1: fijos. Se convierten en configurables por coach en la Fase 3,
// cuando exista el constructor visual de reglas — construir la pantalla de
// configuración ANTES que el constructor significaría escribirla dos veces.
// Cada valor lleva su porqué: son los números que deciden si un coach
// confía en el panel o lo ignora por ruidoso.
const SIGNAL_THRESHOLDS = {
  // Ventana de análisis de antropometría. 28 días = 4 semanas, suficiente
  // para ver una tendencia de 3 semanas y su semana previa de contraste.
  analysisWindowDays: 28,

  stagnation: {
    // Menos de 3 semanas no es un estancamiento, es una semana mala.
    minWeeks: 3,
    // Variación total (en cualquier dirección) por debajo de la cual se
    // considera que el peso no se ha movido. 0,5% de 80 kg = 400 g.
    maxAbsWeightChangePct: 0.5,
    // Sin buena adherencia el problema no es la estrategia, es el
    // cumplimiento — y para eso ya está la alerta de baja adherencia. Un
    // "estancamiento" con 40% de adherencia sería un diagnóstico falso.
    minAdherencePct: 80,
  },

  // Variación semana a semana que deja de ser fluctuación normal de agua/
  // glucógeno y pasa a merecer una mirada.
  sharpWeightChangePctPerWeek: 2,
  // Perímetros: entre dos registros consecutivos. Más alto que el de peso
  // porque la medida con cinta tiene más error de medición.
  sharpMeasurementChangePct: 3,

  lowAdherencePct: 70,
  criticalAdherencePct: 50,
  // No disparar "baja adherencia" con 2 días de datos: con menos de una
  // semana registrada el porcentaje no significa nada todavía.
  minAdherenceCoverageDays: 7,

  inactiveDays: 14,
  inactiveCriticalDays: 21,

  planEndingCriticalDays: 2,
  // Un check-in vencido más de 2 ciclos completos ya no es un olvido.
  checkinOverdueCriticalCycles: 2,
};

// Perímetros vigilados por la señal de "cambio brusco de medidas". Derivados
// del catálogo de check-in que YA define el vocabulario de métricas de la
// app (label incluido, para que la alerta diga "Cintura" y no "waist") en
// vez de mantener una segunda lista que se desincronizaría a la primera
// medida nueva. Solo perímetros: la composición corporal (masa grasa/
// muscular) viene de básculas de bioimpedancia con una varianza diaria que
// dispararía falsos positivos constantes.
const TRACKED_PERIMETERS = CHECKIN_FIELDS.filter(
  (field) => field.group === "perimetros" && field.anthropometryField
).map((field) => ({ key: field.anthropometryField, label: field.label }));

// --- Utilidades de formato (es-ES: coma decimal) ---
function formatNumber(value, decimals = 1) {
  return Number(value).toFixed(decimals).replace(".", ",");
}

function formatSignedPct(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)}%`;
}

function daysBetween(fromDate, toDate) {
  return Math.round((new Date(toDate).getTime() - new Date(fromDate).getTime()) / 86400000);
}

function pctChange(from, to) {
  if (!from) return 0;
  return ((to - from) / from) * 100;
}

// --- Series de antropometría ---
// `entries` llega ordenado ASC por fecha. Devuelve solo los que tienen valor
// en el campo pedido, conservando el orden.
//
// Se descartan además los valores IMPLAUSIBLES (ver isPlausibleAnthropometry).
// No es una precaución teórica: a un cliente le llegó la alerta "Ombligo ha
// bajado 44,0 cm (-35,8%)" porque alguien tecleó 44 donde iban 84. El motor
// se lo creyó y montó el relato entero.
//
// Filtrar aquí y no solo al guardar es lo que arregla el caso de verdad: en
// la base de datos ya hay medidas imposibles de antes de que existieran las
// cotas, y una alerta absurda destruye la confianza en TODAS las demás.
function seriesFor(entries, field) {
  return (entries || [])
    .filter((entry) => isPlausibleAnthropometry(field, entry[field]))
    .map((entry) => ({ date: entry.date, value: entry[field] }));
}

// --- Señales ---

// Estancamiento: el peso no se ha movido en N semanas Y el cliente SÍ está
// cumpliendo. Deliberadamente sin dirección (no distingue "no baja" de "no
// sube"): no existe hoy ningún campo que diga si el objetivo del cliente es
// perder o ganar peso, y deducirlo del histórico sería adivinar. El coach ya
// sabe cuál es el objetivo — lo que no puede ver de un vistazo es a cuál de
// sus 30 clientes se le ha parado la aguja.
function detectStagnation({ weightSeries, adherence, clientName }) {
  const { minWeeks, maxAbsWeightChangePct, minAdherencePct } = SIGNAL_THRESHOLDS.stagnation;
  if (weightSeries.length < 2) return null;

  const first = weightSeries[0];
  const last = weightSeries[weightSeries.length - 1];
  const spanDays = daysBetween(first.date, last.date);
  const spanWeeks = Math.floor(spanDays / 7);
  if (spanWeeks < minWeeks) return null;

  const changePct = pctChange(first.value, last.value);
  if (Math.abs(changePct) >= maxAbsWeightChangePct) return null;

  // Sin adherencia fiable no se puede afirmar que la estrategia sea el
  // problema — se deja pasar y, si procede, saltará la alerta de adherencia.
  if (!adherence || adherence.daysWithData < SIGNAL_THRESHOLDS.minAdherenceCoverageDays) return null;
  if (adherence.percentage < minAdherencePct) return null;

  return {
    type: "stagnation",
    priority: "medium",
    reason:
      `${clientName} lleva ${spanWeeks} semanas sin cambios de peso ` +
      `(${formatSignedPct(changePct)}) con una adherencia del ${adherence.percentage}%.`,
    context: {
      metric: "weight",
      weeks: spanWeeks,
      previousValue: first.value,
      value: last.value,
      changePct: Number(changePct.toFixed(2)),
      adherencePct: adherence.percentage,
      periodDays: spanDays,
    },
  };
}

// Cambio brusco de peso: compara el último registro con el más cercano a 7
// días antes, y normaliza a variación semanal. Se compara contra un registro
// real, no contra "hace exactamente 7 días" — los clientes no se pesan en
// días fijos y exigir la fecha exacta dejaría la señal muerta.
function detectSharpWeightChange({ weightSeries, clientName }) {
  if (weightSeries.length < 2) return null;

  const last = weightSeries[weightSeries.length - 1];
  const previous = weightSeries
    .slice(0, -1)
    .reduce((best, entry) =>
      Math.abs(daysBetween(entry.date, last.date) - 7) < Math.abs(daysBetween(best.date, last.date) - 7)
        ? entry
        : best
    );

  const spanDays = daysBetween(previous.date, last.date);
  if (spanDays <= 0) return null;

  // Un salto imposible no es una señal, es una errata. Se descarta antes de
  // mirar el umbral: si no, la alerta más ruidosa del panel sería siempre la
  // de un dedo que resbaló. Ver isPlausibleChange en checkin-field-catalog.js.
  if (!isPlausibleAnthropometryChange("weight", previous.value, last.value, spanDays)) {
    return null;
  }

  const changePct = pctChange(previous.value, last.value);
  const weeklyChangePct = (changePct / spanDays) * 7;
  if (Math.abs(weeklyChangePct) < SIGNAL_THRESHOLDS.sharpWeightChangePctPerWeek) return null;

  const direction = weeklyChangePct > 0 ? "subido" : "bajado";
  return {
    type: "weight_change",
    priority: "high",
    reason:
      `${clientName} ha ${direction} ${formatNumber(Math.abs(last.value - previous.value))} kg ` +
      `en ${spanDays} días (${formatSignedPct(weeklyChangePct)} por semana).`,
    context: {
      metric: "weight",
      previousValue: previous.value,
      value: last.value,
      changePct: Number(changePct.toFixed(2)),
      weeklyChangePct: Number(weeklyChangePct.toFixed(2)),
      periodDays: spanDays,
    },
  };
}

// Cambio brusco de medidas: revisa todos los perímetros y reporta SOLO el de
// mayor variación. Una única alerta "medidas" por cliente en vez de una por
// perímetro — si un cliente se mide mal un día, se desvían varios a la vez y
// el panel se llenaría de 6 filas del mismo incidente.
function detectSharpMeasurementChange({ entries, clientName }) {
  let biggest = null;

  for (const perimeter of TRACKED_PERIMETERS) {
    const series = seriesFor(entries, perimeter.key);
    if (series.length < 2) continue;

    const last = series[series.length - 1];
    const previous = series[series.length - 2];

    // El caso real que originó esto: "Ombligo ha bajado 44,0 cm (-35,8%)".
    // Los dos valores (123 y 79) eran plausibles POR SEPARADO; lo imposible
    // era el salto. Por eso no basta con las cotas min/max del catálogo.
    if (
      !isPlausibleAnthropometryChange(
        perimeter.key,
        previous.value,
        last.value,
        daysBetween(previous.date, last.date)
      )
    ) {
      continue;
    }

    const changePct = pctChange(previous.value, last.value);
    if (Math.abs(changePct) < SIGNAL_THRESHOLDS.sharpMeasurementChangePct) continue;

    if (!biggest || Math.abs(changePct) > Math.abs(biggest.changePct)) {
      biggest = { perimeter, previous, last, changePct };
    }
  }

  if (!biggest) return null;

  const direction = biggest.changePct > 0 ? "subido" : "bajado";
  return {
    type: "measurement_change",
    priority: "medium",
    reason:
      `${biggest.perimeter.label} de ${clientName} ha ${direction} ` +
      `${formatNumber(Math.abs(biggest.last.value - biggest.previous.value))} cm ` +
      `(${formatSignedPct(biggest.changePct)}) desde la medición anterior.`,
    context: {
      metric: biggest.perimeter.key,
      metricLabel: biggest.perimeter.label,
      previousValue: biggest.previous.value,
      value: biggest.last.value,
      changePct: Number(biggest.changePct.toFixed(2)),
      periodDays: daysBetween(biggest.previous.date, biggest.last.date),
    },
  };
}

function detectLowAdherence({ adherence, clientName }) {
  if (!adherence) return null;
  if (adherence.daysWithData < SIGNAL_THRESHOLDS.minAdherenceCoverageDays) return null;
  if (adherence.percentage >= SIGNAL_THRESHOLDS.lowAdherencePct) return null;

  const isCritical = adherence.percentage < SIGNAL_THRESHOLDS.criticalAdherencePct;
  return {
    type: "low_adherence",
    priority: isCritical ? "high" : "medium",
    reason:
      `${clientName} está cumpliendo el ${adherence.percentage}% de su plan nutricional ` +
      `(${adherence.daysWithData} días registrados).`,
    context: {
      metric: "nutrition_adherence",
      value: adherence.percentage,
      daysWithData: adherence.daysWithData,
      periodDays: adherence.periodDays,
    },
  };
}

// Inactividad: no ha registrado NADA (check-in, medida ni día de dieta con
// algo marcado) en N días. Deliberadamente NO mira entrenamientos: llegar a
// ellos exige recorrer Table -> splits -> workouts con la cascada de
// autopopulate entera (ver table-schema.js), lo que convertiría el job
// nocturno en una carga desproporcionada para una sola fecha. Esa señal
// llega en la Fase 6 con la agregación de entrenamiento, que la resuelve
// con una consulta pensada para ello. La definición actual además cubre a
// los clientes de solo-nutrición, que nunca tendrían entrenamientos.
function detectInactivity({ lastActivityAt, now, clientName }) {
  if (!lastActivityAt) return null;
  const days = daysBetween(lastActivityAt, now);
  if (days < SIGNAL_THRESHOLDS.inactiveDays) return null;

  return {
    type: "inactive_client",
    priority: days >= SIGNAL_THRESHOLDS.inactiveCriticalDays ? "high" : "medium",
    reason: `${clientName} lleva ${days} días sin registrar nada en la app.`,
    context: { metric: "last_activity", value: days, lastActivityAt },
  };
}

function detectCheckinOverdue({ checkin, now, clientName }) {
  if (!checkin?.config) return null;
  const responses = checkin.lastResponseAt ? [{ respondedAt: checkin.lastResponseAt }] : [];
  if (!isCheckinDue(checkin.config, responses, now)) return null;

  const cycles = checkinOverdueCycles(checkin.config, responses, now);
  const isCritical = cycles >= SIGNAL_THRESHOLDS.checkinOverdueCriticalCycles;

  return {
    type: "checkin_overdue",
    priority: isCritical ? "high" : "medium",
    reason: checkin.lastResponseAt
      ? `${clientName} no responde su check-in desde hace ${daysBetween(checkin.lastResponseAt, now)} días.`
      : `${clientName} todavía no ha respondido a su primer check-in.`,
    context: {
      metric: "checkin",
      cadence: checkin.config.cadence,
      overdueCycles: cycles,
      lastResponseAt: checkin.lastResponseAt || null,
    },
  };
}

function detectPendingReview({ relationStatus, clientName }) {
  if (relationStatus !== "en_revision") return null;
  return {
    type: "pending_review",
    // Máxima: hasta que el coach lo confirme, el cliente no tiene acceso al
    // resto de la app — es lo único de esta lista que bloquea a alguien.
    priority: "high",
    reason: `${clientName} ha enviado su cuestionario inicial y espera tu confirmación.`,
    context: { metric: "onboarding" },
  };
}

function detectPlanEndingSoon({ planEndingSoon, clientName }) {
  if (!planEndingSoon) return null;
  const { daysLeft } = planEndingSoon;

  return {
    type: "plan_ending_soon",
    priority: daysLeft <= SIGNAL_THRESHOLDS.planEndingCriticalDays ? "high" : "medium",
    reason:
      daysLeft === 0
        ? `El plan de nutrición de ${clientName} caduca hoy.`
        : `El plan de nutrición de ${clientName} caduca en ${daysLeft} día${daysLeft === 1 ? "" : "s"}.`,
    context: { metric: "plan", daysLeft, endDate: planEndingSoon.endDate || null },
  };
}

// Punto de entrada: todas las señales de UN cliente. Devuelve [] si no hay
// nada que reportar — el caso normal para un cliente que va bien.
function buildSignalsForClient(input) {
  const weightSeries = seriesFor(input.entries, "weight");
  const base = { ...input, weightSeries };

  return [
    detectPendingReview(base),
    detectPlanEndingSoon(base),
    detectCheckinOverdue(base),
    detectSharpWeightChange(base),
    detectLowAdherence(base),
    detectStagnation(base),
    detectSharpMeasurementChange(base),
    detectInactivity(base),
  ].filter(Boolean);
}

module.exports = {
  SIGNAL_THRESHOLDS,
  TRACKED_PERIMETERS,
  buildSignalsForClient,
  // Exportadas para test unitario — cada una se prueba aislada, sin montar
  // el objeto de entrada completo.
  detectStagnation,
  detectSharpWeightChange,
  detectSharpMeasurementChange,
  detectLowAdherence,
  detectInactivity,
  detectCheckinOverdue,
  detectPendingReview,
  detectPlanEndingSoon,
};
