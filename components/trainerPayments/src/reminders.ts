import { Charge, CivilDay, PaymentsError, Recipient, ReminderSettings } from "./types";
import { DEFAULT_TIME_ZONE, addDays, instantForZonedTime, isValidTimeZone, parseTimeOfDay } from "./calendar";
import { balanceOf } from "./ledger";

// PURO — hitos de aviso in-app (sin push, sin email, sin notificaciones del
// sistema operativo).
//
// Política exacta (docs: components/trainerPayments/README.md):
// 1. Hito = día civil de vencimiento + offset, a la hora configurada y en la
//    zona del entrenador. Clave única: cobro + destinatario + revisión del
//    vencimiento + offset. Nunca se repite un hito registrado.
// 2. Solo cobros abiertos con saldo > 0; se revalida justo antes de guardar.
// 3. Ventana: ningún hito anterior a `remindersFrom` del cobro (alta, cambio
//    de vencimiento, reapertura, migración) ni, para el cliente, a la
//    activación de sus avisos. Esos quedan como omitidos.
// 4. Si hay varios hitos alcanzados sin registrar (días sin abrir la app), se emite solo
//    el más reciente dentro de la ventana; los anteriores, omitidos.

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { timeZone: DEFAULT_TIME_ZONE, time: "09:00", offsets: [-3, 0, 3] };
export const OFFSET_MIN = -7; // no más que el horizonte de materialización
export const OFFSET_MAX = 30;
export const OFFSETS_MAX_COUNT = 6;

export function parseOffsets(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > OFFSETS_MAX_COUNT) {
    throw new PaymentsError("INVALID_OFFSETS", `Hasta ${OFFSETS_MAX_COUNT} avisos por cobro.`, 400);
  }
  const offsets = value.map(Number);
  if (offsets.some((offset) => !Number.isInteger(offset) || offset < OFFSET_MIN || offset > OFFSET_MAX)) {
    throw new PaymentsError(
      "INVALID_OFFSETS",
      `Los avisos van de ${-OFFSET_MIN} días antes a ${OFFSET_MAX} días después del vencimiento.`,
      400,
    );
  }
  return [...new Set(offsets)].sort((a, b) => a - b);
}

export interface SettingsBody {
  timeZone?: unknown;
  time?: unknown;
  offsets?: unknown;
}

export function parseReminderSettings(body: SettingsBody): ReminderSettings {
  if (!isValidTimeZone(body.timeZone)) {
    throw new PaymentsError("INVALID_TIME_ZONE", "Zona horaria no válida (usa un nombre como Europe/Madrid).", 400);
  }
  return { timeZone: body.timeZone, time: parseTimeOfDay(body.time, "hora de los avisos"), offsets: parseOffsets(body.offsets) };
}

export function milestoneInstant(dueDay: CivilDay, offset: number, settings: ReminderSettings): Date {
  return instantForZonedTime(addDays(dueDay, offset), settings.time, settings.timeZone);
}

export function milestoneKind(offset: number): "before" | "due" | "after" {
  if (offset < 0) return "before";
  return offset === 0 ? "due" : "after";
}

export function reminderLogKey(recipient: Recipient, dueRevision: number, offset: number): string {
  return `${recipient}:${dueRevision}:${offset}`;
}

export function reminderDedupeKey(chargeId: string, recipient: Recipient, dueRevision: number, offset: number): string {
  return `payrem:${chargeId}:${recipient}:${dueRevision}:${offset}`;
}

export interface Milestone {
  offset: number;
  instant: Date;
}

export interface ReminderDecision {
  emit: Milestone | null;
  skip: Milestone[];
}

export function windowStartFor(charge: Charge, recipient: Recipient, clientEnabledAt: Date | null): Date {
  if (recipient === "client" && clientEnabledAt && clientEnabledAt.getTime() > charge.remindersFrom.getTime()) {
    return clientEnabledAt;
  }
  return charge.remindersFrom;
}

export function decideReminders(
  charge: Charge,
  recipient: Recipient,
  settings: ReminderSettings,
  now: Date,
  windowStart: Date,
): ReminderDecision {
  if (charge.status !== "open" || balanceOf(charge) <= 0) return { emit: null, skip: [] };
  const logged = new Set(
    charge.reminderLog
      .filter((entry) => entry.recipient === recipient && entry.dueRevision === charge.dueRevision)
      .map((entry) => entry.offset),
  );
  const reached = settings.offsets
    .map((offset) => ({ offset, instant: milestoneInstant(charge.dueDay, offset, settings) }))
    .filter((milestone) => milestone.instant.getTime() <= now.getTime() && !logged.has(milestone.offset))
    .sort((a, b) => a.instant.getTime() - b.instant.getTime());
  const skip = reached.filter((milestone) => milestone.instant.getTime() < windowStart.getTime());
  const eligible = reached.filter((milestone) => milestone.instant.getTime() >= windowStart.getTime());
  const emit = eligible.pop() ?? null;
  return { emit, skip: [...skip, ...eligible] };
}

// Rango de vencimientos que pueden tener un hito pendiente hoy: acota la
// consulta de avisos (un cobro vencido hace meses ya no tiene hitos por delante).
export function reminderDueWindow(today: CivilDay): { from: CivilDay; to: CivilDay } {
  return { from: addDays(today, -OFFSET_MAX - 1), to: addDays(today, -OFFSET_MIN + 1) };
}

// Próximo hito futuro de un vencimiento (para previsualizar un cambio de hora/zona).
export function nextMilestone(dueDay: CivilDay, settings: ReminderSettings, now: Date): Milestone | null {
  const upcoming = settings.offsets
    .map((offset) => ({ offset, instant: milestoneInstant(dueDay, offset, settings) }))
    .filter((milestone) => milestone.instant.getTime() > now.getTime())
    .sort((a, b) => a.instant.getTime() - b.instant.getTime());
  return upcoming[0] ?? null;
}
