const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase 4 Coach Pro — el registro de "qué cambié, cuándo y POR QUÉ".
//
// El sistema ya guardaba QUÉ está vigente (NutritionalGoal, PlanAssignment
// con supersededBy, Table), pero no el motivo del cambio ni los valores que
// se dejaron atrás en un formato consultable. Tres semanas después, "2100
// kcal" no dice si eso fue una bajada, una subida o el punto de partida —
// y esa es justo la pregunta que se hace un coach al revisar a un cliente
// que no avanza.
//
// Es un LOG, no una fuente de verdad: nada lee de aquí para resolver qué
// plan rige hoy (eso sigue siendo PlanAssignment/goalInUse). Por eso puede
// crecer sin límite sin afectar a ninguna consulta operativa, y por eso
// borrarlo no rompería nada funcional.
const ChangeSchema = new Schema(
  {
    field: { type: String, required: true },
    // Etiqueta legible ya resuelta ("Calorías"), para que el historial no
    // dependa de que el frontend mantenga un diccionario paralelo de
    // nombres de campo.
    label: { type: String, required: true },
    // Mixed: un cambio puede ser numérico (2200 -> 2100), de texto (nombre
    // del plan) o de fecha (fin de vigencia). Nada consulta por dentro de
    // estos campos — solo se leen para pintar la fila.
    previousValue: { type: Schema.Types.Mixed, default: null },
    newValue: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const PlanChangeSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    entity: {
      type: String,
      required: true,
      enum: ["nutritional_goal", "diet_plan", "routine", "checkin_config", "protocol"],
    },
    // Id del documento afectado. Sin `ref`: apunta a colecciones distintas
    // según `entity`, así que un populate automático no tendría sentido.
    entityId: { type: Schema.Types.ObjectId, default: null },
    // Nombre del elemento en el momento del cambio. Se copia en vez de
    // referenciarse: si el plan se renombra o se borra, el historial debe
    // seguir contando lo que pasó entonces.
    entityName: { type: String, trim: true, maxlength: 120, default: "" },

    action: { type: String, required: true, enum: ["created", "updated", "assigned", "replaced"] },
    changes: { type: [ChangeSchema], default: [] },

    // El "porqué" del cambio. Opcional a propósito: exigirlo en cada
    // acción convertiría una operación que un coach repite decenas de veces
    // al día en un formulario, y acabaría rellenándose con basura. Se pide,
    // no se obliga.
    reason: { type: String, trim: true, maxlength: 500, default: "" },

    createdAt: { type: Date, default: Date.now },
  },
  { collection: "planchanges" }
);

// Consulta principal: "el historial de este cliente, lo más reciente
// primero". El filtro por entity es secundario (pestañas del historial).
PlanChangeSchema.index({ clientId: 1, createdAt: -1 });
PlanChangeSchema.index({ trainerId: 1, createdAt: -1 });

PlanChangeSchema.plugin(require("../util/account-cascade").accountCascade, { owners: ["trainerId", "clientId"] });

module.exports = mongoose.model("PlanChange", PlanChangeSchema);
