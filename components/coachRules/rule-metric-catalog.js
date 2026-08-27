const { CHECKIN_FIELDS } = require("../trainerCheckins/checkin-field-catalog");

// Fase 3 Coach Pro — el VOCABULARIO del motor de reglas: qué se puede medir,
// con qué operadores y sobre qué periodo.
//
// Es un catálogo cerrado, igual que CHECKIN_FIELDS. Un coach no escribe
// expresiones: elige de estas listas en el constructor visual, y el backend
// valida contra ellas. Eso hace imposible una regla sintácticamente rota, y
// permite que la UI ofrezca solo los operadores que tienen sentido para cada
// métrica (no se pregunta "¿ha bajado un 5%?" sobre un nivel de estrés).
//
// LÍMITE DELIBERADO DE ESTA FASE: solo hay métricas que el evaluador
// nocturno YA carga de forma barata para todos los clientes de un
// profesional (ver coach-alert-service.js#loadTrainerContext). La adherencia
// de entrenamiento y de hábitos exigen, cliente a cliente, la agregación de
// tablas y el recuento de TaskCompletion — asequible en la ficha de UN
// cliente (Fase 2), ruinoso multiplicado por 30 cada noche. Entran en el
// catálogo en la Fase 6, que es la que construye esa agregación barata.

// --- Operadores, por tipo de métrica ---
// `series`: valores fechados que además permiten preguntar por la variación.
// `average`: se promedia el periodo y se compara el promedio.
// `days`: cuántos días han pasado desde algo.
const OPERATORS = {
  gt: { key: "gt", label: "es mayor que" },
  gte: { key: "gte", label: "es mayor o igual que" },
  lt: { key: "lt", label: "es menor que" },
  lte: { key: "lte", label: "es menor o igual que" },
  dropped_more_than_pct: { key: "dropped_more_than_pct", label: "ha bajado más de", suffix: "%" },
  dropped_less_than_pct: { key: "dropped_less_than_pct", label: "ha bajado menos de", suffix: "%" },
  rose_more_than_pct: { key: "rose_more_than_pct", label: "ha subido más de", suffix: "%" },
  changed_less_than_pct: { key: "changed_less_than_pct", label: "apenas ha cambiado (menos de)", suffix: "%" },
};

const OPERATORS_BY_KIND = {
  series: [
    "dropped_more_than_pct",
    "dropped_less_than_pct",
    "rose_more_than_pct",
    "changed_less_than_pct",
    "gt",
    "lt",
  ],
  average: ["gt", "gte", "lt", "lte"],
  days: ["gt", "gte", "lt", "lte"],
};

// Periodos ofrecidos. Cerrados igual que los operadores: el periodo máximo
// coincide con la ventana que carga el evaluador nocturno
// (SIGNAL_THRESHOLDS.analysisWindowDays), así que pedir 90 días devolvería
// datos truncados sin avisar.
const PERIODS = [
  { days: 7, label: "en 1 semana" },
  { days: 14, label: "en 2 semanas" },
  { days: 21, label: "en 3 semanas" },
  { days: 28, label: "en 4 semanas" },
];

const MAX_PERIOD_DAYS = 28;

// --- Resolutores ---
// Cada uno recibe el snapshot del cliente ya cargado y devuelve un número, o
// null si no hay datos suficientes para afirmar nada. `null` NUNCA cumple una
// condición: una regla no debe dispararse por ausencia de datos.

function seriesFor(entries, field) {
  return (entries || [])
    .filter((e) => typeof e[field] === "number" && Number.isFinite(e[field]))
    .map((e) => ({ date: e.date, value: e[field] }));
}

function withinPeriod(series, periodDays, now) {
  const cutoff = new Date(now.getTime() - periodDays * 86400000).toISOString().slice(0, 10);
  return series.filter((point) => point.date >= cutoff);
}

// Para una métrica de tipo serie devuelve {current, changePct} sobre el
// periodo pedido — dos valores porque los operadores de comparación directa
// (gt/lt) miran el actual y los de variación miran el cambio.
function resolveSeries(field) {
  return (snapshot, periodDays) => {
    const series = withinPeriod(seriesFor(snapshot.entries, field), periodDays, snapshot.now);
    if (!series.length) return null;
    const current = series[series.length - 1].value;
    if (series.length < 2) return { current, changePct: null };
    const first = series[0].value;
    return { current, changePct: first ? ((current - first) / first) * 100 : null };
  };
}

// Media de un campo de bienestar en el periodo.
function resolveWellbeingAverage(field) {
  return (snapshot, periodDays) => {
    const cutoff = new Date(snapshot.now.getTime() - periodDays * 86400000);
    const values = (snapshot.checkinResponses || [])
      .filter((r) => new Date(r.respondedAt) >= cutoff)
      .map((r) => Number(r.values?.[field]))
      .filter((v) => Number.isFinite(v));
    if (!values.length) return null;
    return { current: values.reduce((a, b) => a + b, 0) / values.length, changePct: null };
  };
}

// --- Catálogo ---

const BASE_METRICS = [
  {
    key: "weight",
    label: "Peso",
    unit: "kg",
    kind: "series",
    group: "composicion",
    resolve: resolveSeries("weight"),
  },
  {
    key: "nutrition_adherence",
    label: "Adherencia nutricional",
    unit: "%",
    kind: "average",
    group: "adherencia",
    // No depende del periodo: el evaluador la calcula una vez sobre su
    // ventana de análisis. Pedir "adherencia en 1 semana" daría el mismo
    // número que "en 4" — por eso la UI oculta el selector de periodo en
    // las métricas de tipo `average` sin serie propia (ver periodAware).
    periodAware: false,
    resolve: (snapshot) =>
      snapshot.adherence?.percentage === null || snapshot.adherence?.percentage === undefined
        ? null
        : { current: snapshot.adherence.percentage, changePct: null },
  },
  {
    // Fase 6 Coach Pro — sesiones entrenadas en el periodo. Entra en el
    // catálogo porque su consulta SÍ es barata en lote
    // (tableDao.listCompletedWorkoutDatesForUsers: una agregación para toda
    // la cartera). El volumen y los PRs siguen fuera: su consulta devuelve
    // una fila por serie completada, asequible para una ficha abierta y
    // ruinosa multiplicada por 30 clientes cada noche.
    key: "training_sessions",
    label: "Sesiones entrenadas",
    unit: "sesiones",
    kind: "average",
    group: "adherencia",
    periodAware: true,
    resolve: (snapshot, periodDays) => {
      if (!snapshot.workoutDates) return null;
      const cutoff = new Date(snapshot.now.getTime() - periodDays * 86400000);
      const count = snapshot.workoutDates.filter((d) => new Date(d) >= cutoff).length;
      return { current: count, changePct: null };
    },
  },
  {
    // Movimiento 3 Coach Pro — el dolor MÁS ALTO reportado en el periodo, de
    // cualquier zona. Es lo que un entrenador quiere automatizar ("avísame
    // si alguna zona pasa de 5"), y no la media: una rodilla que un día
    // llega a 8 es un problema aunque el resto de la semana esté a 1, y
    // promediarlo lo escondería justo cuando importa.
    //
    // Entra en el catálogo porque su consulta SÍ es barata en lote
    // (painDao.listForUsersSince: una consulta para toda la cartera), el
    // mismo criterio que dejó fuera al volumen de entrenamiento.
    key: "pain_max",
    label: "Dolor máximo reportado",
    unit: "/10",
    kind: "average",
    group: "bienestar",
    periodAware: true,
    resolve: (snapshot, periodDays) => {
      if (!snapshot.painEntries?.length) return null;
      const cutoff = new Date(snapshot.now.getTime() - periodDays * 86400000)
        .toISOString()
        .slice(0, 10);
      const levels = snapshot.painEntries
        .filter((entry) => entry.date >= cutoff)
        .map((entry) => entry.level)
        .filter((level) => Number.isFinite(level));
      if (!levels.length) return null;
      return { current: Math.max(...levels), changePct: null };
    },
  },
  {
    key: "days_since_checkin",
    label: "Días sin responder al check-in",
    unit: "días",
    kind: "days",
    group: "seguimiento",
    periodAware: false,
    resolve: (snapshot) => {
      if (!snapshot.lastResponseAt) return null;
      const days = Math.floor(
        (snapshot.now.getTime() - new Date(snapshot.lastResponseAt).getTime()) / 86400000
      );
      return { current: days, changePct: null };
    },
  },
  {
    key: "days_since_activity",
    label: "Días sin actividad en la app",
    unit: "días",
    kind: "days",
    group: "seguimiento",
    periodAware: false,
    resolve: (snapshot) => {
      if (!snapshot.lastActivityAt) return null;
      const days = Math.floor(
        (snapshot.now.getTime() - new Date(snapshot.lastActivityAt).getTime()) / 86400000
      );
      return { current: days, changePct: null };
    },
  },
];

// Perímetros y bienestar salen del catálogo de check-in — la misma fuente que
// usan las señales integradas, la serie semanal y el propio formulario que
// rellena el cliente. Mantener una segunda lista aquí garantizaría que se
// desincronizara a la primera métrica nueva.
const PERIMETER_METRICS = CHECKIN_FIELDS.filter(
  (f) => f.group === "perimetros" && f.anthropometryField
).map((f) => ({
  key: `perimeter_${f.anthropometryField}`,
  label: f.label,
  unit: f.unit || "cm",
  kind: "series",
  group: "medidas",
  resolve: resolveSeries(f.anthropometryField),
}));

const WELLBEING_METRICS = CHECKIN_FIELDS.filter(
  (f) => f.storage === "wellbeing" && f.type !== "text"
).map((f) => ({
  key: `wellbeing_${f.key}`,
  label: f.label,
  unit: f.unit || "",
  kind: "average",
  group: "bienestar",
  periodAware: true,
  resolve: resolveWellbeingAverage(f.key),
}));

const RULE_METRICS = [...BASE_METRICS, ...PERIMETER_METRICS, ...WELLBEING_METRICS];
const RULE_METRICS_BY_KEY = new Map(RULE_METRICS.map((m) => [m.key, m]));

// Lo que se envía al constructor visual: sin las funciones `resolve`, que no
// son serializables, y con los operadores válidos ya resueltos por métrica
// para que la UI no tenga que saber nada de `kind`.
function toCatalogDto() {
  return {
    metrics: RULE_METRICS.map(({ resolve, kind, ...rest }) => ({
      ...rest,
      kind,
      operators: (OPERATORS_BY_KIND[kind] || []).map((key) => OPERATORS[key]),
      periodAware: rest.periodAware !== false && kind === "series" ? true : rest.periodAware === true,
    })),
    periods: PERIODS,
  };
}

module.exports = {
  OPERATORS,
  OPERATORS_BY_KIND,
  PERIODS,
  MAX_PERIOD_DAYS,
  RULE_METRICS,
  RULE_METRICS_BY_KEY,
  toCatalogDto,
};
