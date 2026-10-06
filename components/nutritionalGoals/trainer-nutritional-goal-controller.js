// El objetivo nutricional del cliente, visto y editado por su profesional
// (docs/plan-semanas.md). Antes el profesional ni lo veía: su meta
// salía de lo pautado día a día y el objetivo del cliente solo cubría los
// días sin nada pautado. Eso dejaba al profesional trabajando a ciegas sobre
// el número que el cliente SÍ ve en su app.
//
// Editar aquí marca el objetivo como "manual": recalcularlo desde el perfil
// deja de pisarlo, porque alguien decidió esas kcal a propósito.

const nutritionalGoalService = require("./nutritional-goal-service");

function round1(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

function goalResponse(goal) {
  if (!goal) return null;
  return {
    _id: goal._id,
    name: goal.name,
    kcalTotal: goal.kcalTotal,
    proteinsGTotal: goal.proteinsGTotal,
    carbohydratesGTotal: goal.carbohydratesGTotal,
    fatGTotal: goal.fatGTotal,
    fiberGTotal: goal.fiberGTotal ?? null,
    source: goal.source || "calculated",
    updatedAt: goal.updatedAt,
  };
}

module.exports = {
  // GET /trainer/clients/:clientId/nutritional-goal
  // El objetivo vigente del cliente + cómo se calcularía hoy (inputs y
  // desglose), que es lo que pinta el bloque "cómo se ha calculado".
  async getForClient(req, res) {
    const { goal, resolved, steps } = await nutritionalGoalService.clientGoalView(req.params.clientId);

    return res.send({
      goal: goalResponse(goal),
      calculated: resolved.ok
        ? {
            target: resolved.target,
            inputs: resolved.inputs,
            breakdown: resolved.breakdown,
            weightSource: resolved.weightSource,
            stepsFromHabit: steps,
          }
        : null,
      missing: resolved.ok ? null : resolved.missing,
    });
  },

  // PUT /trainer/clients/:clientId/nutritional-goal
  // body: { kcalTotal, proteinsGTotal, carbohydratesGTotal, fatGTotal, fiberGTotal? }
  //   o   { recalculate: true } para volver al valor calculado del perfil.
  async updateForClient(req, res) {
    const { clientId } = req.params;

    if (req.body?.recalculate) {
      const goal = await nutritionalGoalService.recalculateForClient(clientId);
      if (!goal) {
        return res.status(422).send({
          message: "Faltan datos del cliente para calcular su objetivo",
          code: "MISSING_BIOMETRICS",
        });
      }
      return res.send(goalResponse(goal));
    }

    const kcal = Number(req.body?.kcalTotal);
    if (!Number.isFinite(kcal) || kcal <= 0) {
      return res.status(400).send({ message: "Las kcal deben ser mayores que 0" });
    }
    const updates = {
      kcalTotal: Math.round(kcal),
      proteinsGTotal: round1(req.body?.proteinsGTotal),
      carbohydratesGTotal: round1(req.body?.carbohydratesGTotal),
      fatGTotal: round1(req.body?.fatGTotal),
    };
    if (req.body?.fiberGTotal !== undefined) {
      const fiber = Number(req.body.fiberGTotal);
      updates.fiberGTotal = Number.isFinite(fiber) && fiber >= 0 ? round1(fiber) : null;
    }

    const { goal, created } = await nutritionalGoalService.setManualGoalForClient(req.auth.userId, clientId, updates);
    return res.status(created ? 201 : 200).send(goalResponse(goal));
  },
};
