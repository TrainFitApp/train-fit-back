const mongoose = require("mongoose");
const TrainerPayment = require("./trainer-payment-schema");

module.exports = {
  async create(trainerId, clientId, { amount, currency, dueDate, note }) {
    return TrainerPayment.create({ trainerId, clientId, amount, currency, dueDate, note });
  },

  async list(trainerId, clientId) {
    return TrainerPayment.find({ trainerId, clientId }).sort({ dueDate: -1 }).lean();
  },

  async markPaid(trainerId, clientId, paymentId, paid) {
    return TrainerPayment.findOneAndUpdate(
      { _id: paymentId, trainerId, clientId },
      { $set: { paidAt: paid ? new Date() : null } },
      { new: true }
    ).lean();
  },

  // Cobros pendientes de un cliente, de CUALQUIER profesional (el controller
  // filtra por relación activa) — primera vía de lectura de lado cliente,
  // usada por el dashboard del tab Coach. Solo lectura: no existe pago real
  // in-app, es un recordatorio manual (ver schema).
  async listPendingForClient(clientId) {
    return TrainerPayment.find({ clientId, paidAt: null }).sort({ dueDate: 1 }).lean();
  },

  // Resumen agregado de cobros de TODOS los clientes de un trainer — para
  // el dashboard (tarjeta + gráfica "Cobros"). Dos queries agregadas, no un
  // fan-out por cliente (a diferencia del gráfico de evolución de peso que
  // esto sustituyó, que sí hacía una petición por cliente).
  // Simplificación consciente MVP: suma amount cruzando currency sin
  // convertir — el ledger es manual y en la práctica el trainer usa una sola
  // divisa (default EUR); no se resuelve tasa de cambio aquí.
  async getPaymentsOverview(trainerId) {
    const trainerObjectId = new mongoose.Types.ObjectId(trainerId);

    const [pendingResult] = await TrainerPayment.aggregate([
      { $match: { trainerId: trainerObjectId, paidAt: null } },
      {
        $group: {
          _id: null,
          pendingAmount: { $sum: "$amount" },
          pendingCount: { $sum: 1 },
          overdueCount: {
            $sum: { $cond: [{ $lt: ["$dueDate", new Date()] }, 1, 0] },
          },
        },
      },
    ]);

    // Serie mensual: total facturado (dueDate), pagado o no — "cobros de
    // este mes" tal como lo entendería el trainer, no solo lo ya cobrado.
    // Últimos 6 meses, incluido el actual. Todo en UTC a propósito: los
    // operadores $year/$month de Mongo agregan en UTC por defecto, así que
    // el lado JS tiene que construir/leer fechas también en UTC — mezclar
    // con hora local (setDate/setMonth/getMonth) desalinea el mes actual
    // con el mes que Mongo agrupa cerca de medianoche o de fin de mes
    // (bug real encontrado y corregido en esta misma sesión).
    const now = new Date();
    const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

    const monthlyRaw = await TrainerPayment.aggregate([
      { $match: { trainerId: trainerObjectId, dueDate: { $gte: rangeStart } } },
      {
        $group: {
          _id: { year: { $year: "$dueDate" }, month: { $month: "$dueDate" } },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);
    const byKey = new Map(
      monthlyRaw.map((r) => [`${r._id.year}-${r._id.month}`, r.totalAmount])
    );

    const monthlySeries = [];
    for (let i = 0; i < 6; i++) {
      const cursorYear = rangeStart.getUTCFullYear();
      const cursorMonth = rangeStart.getUTCMonth() + i; // puede superar 11, Date.UTC lo normaliza
      const cursor = new Date(Date.UTC(cursorYear, cursorMonth, 1));
      const key = `${cursor.getUTCFullYear()}-${cursor.getUTCMonth() + 1}`;
      monthlySeries.push({
        month: `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`,
        totalAmount: byKey.get(key) || 0,
      });
    }

    const current = monthlySeries[monthlySeries.length - 1].totalAmount;
    const previous = monthlySeries[monthlySeries.length - 2].totalAmount;
    let percentChangeVsLastMonth = null;
    if (previous > 0) {
      percentChangeVsLastMonth = Math.round(((current - previous) / previous) * 100);
    } else if (current > 0) {
      percentChangeVsLastMonth = 100;
    }

    return {
      pendingAmount: pendingResult?.pendingAmount || 0,
      pendingCount: pendingResult?.pendingCount || 0,
      overdueCount: pendingResult?.overdueCount || 0,
      monthlySeries,
      percentChangeVsLastMonth,
    };
  },
};
