const clientProgressService = require("./client-progress-service");
const { buildRoster, parseRosterQuery, paginateRoster, ROSTER_WINDOW_DAYS } = require("./roster-service");

// Las únicas ventanas de tendencia que ofrece la pantalla. Cerradas a
// propósito: un `weeks` libre desde el query string es una invitación a
// pedir 520 semanas y tumbar la agregación de entrenamiento.
const ALLOWED_WEEKS = [4, 8, 12];
const DEFAULT_WEEKS = 4;

// Comparación de VARIOS ejercicios a la vez (2026-09) — mismo tope que
// TOP_EXERCISES en training-service.js ("evolución de cargas" de Resumen):
// más de 5 líneas en la misma gráfica deja de leerse.
const MAX_COMPARED_EXERCISES = 5;

// Parámetros repetidos (?exercises=A&exercises=B), no una lista separada por
// comas: un nombre de ejercicio con una coma literal rompería el split sin
// forma de distinguirla del separador. Express da un string con UNA
// aparición y un array con dos o más — hay que normalizar los dos casos.
function parseExerciseList(query) {
  const raw = query.exercises;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const names = values
    .filter((name) => typeof name === "string")
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)].slice(0, MAX_COMPARED_EXERCISES);
}

// Tarea 4 (2026-09) — comparación por microciclo en Entrenamiento: el
// entrenador elige un rango libre en un calendario, no una de las 3
// ventanas fijas de arriba. Mismo criterio de "no dejar pedir 520 semanas"
// que ALLOWED_WEEKS, pero como límite de días en vez de lista cerrada,
// porque un rango libre no tiene un conjunto finito de valores válidos.
const MAX_CUSTOM_RANGE_DAYS = 366;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseCustomRange(query) {
  const { from, to } = query;
  if (!from || !to || !ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) return null;
  if (from > to) return null;
  const days =
    Math.round(
      (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / 86400000
    ) + 1;
  if (days > MAX_CUSTOM_RANGE_DAYS) return null;
  return { from, to };
}

const weeksOf = (query) => {
  const requested = Number(query.weeks);
  return ALLOWED_WEEKS.includes(requested) ? requested : DEFAULT_WEEKS;
};

module.exports = {
  // GET /trainer/roster?page=&limit=&search=&sort=&dir=&weakest=&alerts=&overdue=&pending=
  // Movimiento 1 Coach Pro: una fila por cliente con adherencia, punto
  // débil, peso, último check-in y alertas abiertas.
  //
  // Paginada: la tabla pide una página con su búsqueda, filtros y orden y
  // solo viaja esa página (más el bloque "Pendientes", que va entero). El
  // cálculo sigue siendo de la cartera entera — ver paginateRoster.
  //
  // Sin requireActiveClient porque no hay :clientId: el propio buildRoster
  // parte de listActiveClientsForTrainer, así que la respuesta no puede
  // contener a nadie que no lleve este profesional.
  async getRoster(req, res) {
    const options = parseRosterQuery(req.query);
    const rows = await buildRoster(req.auth.userId, { timeZone: req.auth.timeZone });
    return res.send({ periodDays: ROSTER_WINDOW_DAYS, ...paginateRoster(rows, options) });
  },

  // GET /trainer/clients/:clientId/summary — Movimiento 2 Coach Pro.
  async getSummary(req, res) {
    return res.send(await clientProgressService.summary(req.auth.userId, req.params.clientId, req.auth.timeZone));
  },

  // GET /trainer/clients/:clientId/progress?weeks=4|8|12 — serie semanal +
  // comparativa de la última semana contra la anterior.
  async getProgress(req, res) {
    return res.send(await clientProgressService.weeklyProgress(req.auth.userId, req.params.clientId, weeksOf(req.query)));
  },

  // GET /trainer/clients/:clientId/training-progress?weeks=4|8|12
  //   ó ?from=YYYY-MM-DD&to=YYYY-MM-DD (rango libre, comparación por microciclo)
  //   &workout=nombre &exercises=A&exercises=B
  // Aparte de /progress a propósito: devuelve una fila POR SERIE COMPLETADA
  // (miles en un trimestre) y es con diferencia la consulta más cara del
  // módulo; quien solo mira peso y adherencia no la paga.
  async getTrainingProgress(req, res) {
    return res.send(
      await clientProgressService.trainingProgress(req.params.clientId, {
        customRange: parseCustomRange(req.query),
        requestedWeeks: weeksOf(req.query),
        workoutName: typeof req.query.workout === "string" ? req.query.workout.trim() : "",
        exerciseNames: parseExerciseList(req.query),
      })
    );
  },
};
