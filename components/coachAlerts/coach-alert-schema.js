const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Fase 1 Coach Pro — la pieza que faltaba: la alerta como OBJETO, no como
// una lista recalculada en cada GET.
//
// Antes de esto, "requiere tu atención" (trainer-client-controller.js
// #getAttentionItems) recalculaba 3 señales al vuelo en cada petición. Eso
// funcionaba porque las 3 salían de consultas indexadas baratas, pero
// impedía todo lo demás que un coach necesita de una alerta: prioridad,
// estado (abierta/resuelta/descartada), nota de por qué se resolvió,
// historial de lo que pasó, y —a partir de la Fase 3— qué regla la generó.
// Además, las señales nuevas (estancamiento, adherencia, cambio brusco de
// peso/medidas) NO se pueden calcular en un GET: necesitan una ventana de
// 28 días de antropometría y días de dieta por cliente. Recalcularlas para
// 30 clientes en cada carga del dashboard sería un fan-out de cientos de
// consultas (ver coach-alert-service.js, riesgo R1 de la auditoría).
//
// Por eso: el cron nocturno evalúa y ESCRIBE aquí; el dashboard LEE de aquí
// con una sola consulta indexada.
const CoachAlertSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },

    // Vocabulario cerrado. Solo están los tipos que el evaluador PRODUCE hoy
    // — no se declaran de antemano los de fases posteriores ("caída de
    // rendimiento" necesita la agregación de entrenamiento de la Fase 6,
    // "objetivo incumplido" necesita objetivos con criterio de éxito): un
    // enum con valores que nada emite es contrato muerto.
    type: {
      type: String,
      required: true,
      enum: [
        "pending_review", // cuestionario inicial esperando confirmación del coach
        "checkin_overdue", // check-in vencido según su cadencia
        "plan_ending_soon", // plan de nutrición a punto de caducar
        "stagnation", // sin cambio de peso pese a buena adherencia
        "weight_change", // variación de peso brusca semana a semana
        "measurement_change", // variación brusca de un perímetro
        "low_adherence", // adherencia nutricional por debajo del umbral
        "inactive_client", // sin registrar nada (check-in/medida/dieta) en N días
        // Fase 3 — generada por una regla del propio coach. Un único valor
        // para todas: lo que la distingue no es un tipo del sistema sino
        // QUÉ regla la creó, y eso ya vive en `ruleId`. Añadir un tipo por
        // regla haría el enum ilimitado y dependiente de datos de usuario.
        "rule_matched",
      ],
    },

    priority: { type: String, required: true, enum: ["high", "medium", "low"], default: "medium" },

    // Frase ya redactada y lista para pintar, con los números dentro
    // ("Juan lleva 3 semanas sin bajar de peso con un 91% de adherencia").
    // Se guarda en vez de recomponerse al leer porque describe el estado en
    // el momento en que se detectó: reconstruirla luego con datos que ya han
    // cambiado contaría otra historia distinta de la que disparó la alerta.
    reason: { type: String, required: true, trim: true, maxlength: 300 },

    // Los números crudos detrás de `reason` (métrica, valor, valor anterior,
    // periodo...). Mixed porque cada tipo de alerta tiene su propia forma y
    // nada consulta por dentro de este campo — solo se lee entero para
    // pintar el detalle. Un sub-schema por tipo sería 8 formas para un campo
    // que nunca se filtra.
    context: { type: Schema.Types.Mixed, default: {} },

    // Fase 3 — regla del coach que generó la alerta. `null` = la generó el
    // evaluador de señales del sistema (todas las de Fase 1).
    ruleId: { type: Schema.Types.ObjectId, ref: "CoachRule", default: null },

    status: { type: String, enum: ["open", "resolved", "dismissed"], default: "open", index: true },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    coachNote: { type: String, trim: true, maxlength: 1000, default: "" },

    // Identidad estable de "este problema, de este cliente, con este coach".
    // NO incluye fecha: una alerta de estancamiento que sigue vigente tres
    // noches seguidas debe seguir siendo LA MISMA alerta (se refresca
    // lastSeenAt), no tres. Es la defensa contra el riesgo R3 de la
    // auditoría: sin esto, un cliente estancado generaría una alerta por
    // noche y el coach dejaría de mirar el panel entero.
    dedupeKey: { type: String, required: true },

    // Última vez que el evaluador volvió a detectar la misma condición.
    // Distinto de createdAt (cuándo apareció por primera vez): la ficha
    // muestra "detectado hace 3 semanas, sigue vigente".
    lastSeenAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: "coachalerts" }
);

// Consulta principal del dashboard: "las alertas abiertas de este coach, las
// más graves primero". Cubre también el filtro por status del historial.
CoachAlertSchema.index({ trainerId: 1, status: 1, priority: 1, createdAt: -1 });

// La ficha del cliente pide "las alertas de ESTE cliente" — sin este índice
// sería un escaneo del resto de clientes del mismo coach.
CoachAlertSchema.index({ clientId: 1, status: 1, createdAt: -1 });

// Como mucho UNA alerta abierta por dedupeKey. Es un invariante de datos, no
// solo una comprobación del servicio: si dos ejecuciones del cron se
// solaparan (reinicio en caliente, ejecución manual del script mientras
// corre la programada), el índice impide el duplicado aunque la lógica de
// upsert perdiera la carrera. Parcial sobre status:"open" a propósito — el
// histórico de resueltas SÍ puede repetir clave (mismo problema, meses
// después) y debe conservarse entero.
CoachAlertSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { status: "open" } }
);

module.exports = mongoose.model("CoachAlert", CoachAlertSchema);
