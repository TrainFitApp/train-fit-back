import { createHash } from "node:crypto";
import { PaymentsError } from "./types";

// Todo importe vive en céntimos enteros. Los decimales de coma flotante solo
// aparecen en el borde (entrada del formulario).
export const MAX_AMOUNT_CENTS = 100_000_000; // 1.000.000,00
const AMOUNT_TEXT = /^\d{1,7}(?:[.,]\d{1,2})?$/;
const OPERATION_ID = /^[A-Za-z0-9_.:-]{8,120}$/;

export function parseAmountToCents(value: unknown, field = "amount"): number {
  let cents: number | null = null;
  if (typeof value === "number" && Number.isFinite(value)) {
    const scaled = value * 100;
    const rounded = Math.round(scaled);
    // 19.99 * 100 = 1998.9999999999998: tolerancia mínima, pero 10.005 no pasa.
    if (Math.abs(scaled - rounded) < 1e-6) cents = rounded;
  } else if (typeof value === "string") {
    const text = value.trim();
    if (AMOUNT_TEXT.test(text)) {
      const [whole, fraction = ""] = text.split(/[.,]/);
      cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    }
  }
  if (cents === null || !Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_AMOUNT_CENTS) {
    throw new PaymentsError(
      "INVALID_AMOUNT",
      "El importe debe ser positivo, con dos decimales como máximo y hasta 1.000.000.",
      400,
      { field },
    );
  }
  return cents;
}

export function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

export function parseOperationId(value: unknown): string {
  if (typeof value !== "string" || !OPERATION_ID.test(value)) {
    throw new PaymentsError(
      "INVALID_OPERATION_ID",
      "Falta el identificador de operación (8-120 caracteres) que evita duplicados al reintentar.",
      400,
    );
  }
  return value;
}

export function cleanText(
  value: unknown,
  max: number,
  field: string,
  { required = false, min = 0 }: { required?: boolean; min?: number } = {},
): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new PaymentsError("INVALID_TEXT", `El campo ${field} es obligatorio.`, 400, { field });
    return null;
  }
  if (typeof value !== "string") throw new PaymentsError("INVALID_TEXT", `El campo ${field} no es válido.`, 400, { field });
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) {
    if (required) throw new PaymentsError("INVALID_TEXT", `El campo ${field} es obligatorio.`, 400, { field });
    return null;
  }
  if (text.length < min || text.length > max) {
    throw new PaymentsError("INVALID_TEXT", `El campo ${field} debe tener entre ${min} y ${max} caracteres.`, 400, { field });
  }
  return text;
}

// Huella de la carga útil de una operación idempotente: el mismo
// operationId con otra carga es un error, no un reintento.
export function payloadHash(parts: ReadonlyArray<string | number | boolean | null>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}
