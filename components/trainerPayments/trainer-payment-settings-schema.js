const mongoose = require("mongoose");
const Schema = mongoose.Schema;

// Preferencias de cobros de un entrenador (Configuración > Cobros). Sin
// documento se usan los valores por defecto (reminders.ts#DEFAULT_REMINDER_SETTINGS):
// Europe/Madrid, 09:00 y avisos -3/0/+3. La zona se persiste aquí: abrir la
// app desde otro dispositivo nunca cambia qué día es "hoy" para sus cobros.
const TrainerPaymentSettingsSchema = new Schema(
  {
    trainerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
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
  },
  { collection: "trainerpaymentsettings", timestamps: true }
);

TrainerPaymentSettingsSchema.index({ trainerId: 1 }, { unique: true });

module.exports = mongoose.model("TrainerPaymentSettings", TrainerPaymentSettingsSchema);
