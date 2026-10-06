const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Preferencias de cobros de un entrenador (Configuración > Cobros). Desde
// 2026-10 viven EMBEBIDAS en su usuario (User.trainerSettings.payments): eran
// una colección propia (`trainerpaymentsettings`) con un documento por
// entrenador que solo se leía por `trainerId`. Sin subdocumento se usan los
// valores por defecto (reminders.ts#DEFAULT_REMINDER_SETTINGS): Europe/Madrid,
// 09:00 y avisos -3/0/+3. La zona se persiste aquí: abrir la app desde otro
// dispositivo nunca cambia qué día es "hoy" para sus cobros.
const TrainerPaymentSettingsSchema = new Schema(
  {
    timeZone: { type: String, required: true },
    time: { type: String, required: true },
    offsets: { type: [Number], default: [] },
    revision: { type: Number, default: 0 },
    history: {
      type: [
        new Schema(
          {
            at: { type: Date, required: true },
            timeZone: String,
            time: String,
            offsets: [Number],
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    updatedAt: { type: Date },
  },
  { _id: false }
);

module.exports = TrainerPaymentSettingsSchema;
