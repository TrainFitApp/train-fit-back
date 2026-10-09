const { TASK_TYPES } = require("./task-label");
const { badRequest } = require("../util/http-error");

// PURO — lo que el profesional manda al crear o editar un hábito, validado
// con códigos (QA 2026-10-09, M14 y B: «unit es obligatorio», «target debe
// ser un número positivo»… salían en español y sin código, y la app en
// inglés los enseñaba tal cual; un objetivo de 10¹² litros de agua se
// guardaba).

const LABEL_MAX = 100;
const UNIT_MAX = 20;

// Tope razonable del objetivo por tipo (el agua, según su unidad): por
// encima es una errata, no una pauta.
function maxTargetFor(type, unit) {
  if (type === "steps") return 100000;
  if (type === "sleep") return 24;
  if (type === "water") return /^ml$/i.test(String(unit || "").trim()) ? 20000 : 20;
  return 100000;
}

const invalid = (code, message, details) => badRequest(message, code, details);
const present = (value) => value !== undefined && value !== null && value !== "";

/**
 * `current`: el hábito que se edita (sin él, es un alta). El tipo no se
 * cambia al editar. Devuelve { type, label, target, targetMax, unit } con lo
 * que hay que guardar.
 */
function parseTaskInput(body = {}, current = null) {
  const type = current ? current.type : body.type;
  if (!TASK_TYPES.includes(type)) throw invalid("TASK_INVALID_TYPE", "Tipo de hábito no válido", { allowed: TASK_TYPES });

  const rawLabel = body.label !== undefined ? body.label : current?.label;
  const label = typeof rawLabel === "string" ? rawLabel.trim() : null;
  if (type === "custom" && !label) throw invalid("TASK_LABEL_REQUIRED", "Ponle un nombre al hábito");
  if (label && label.length > LABEL_MAX) throw invalid("TASK_LABEL_TOO_LONG", `El nombre admite como mucho ${LABEL_MAX} caracteres`, { max: LABEL_MAX });

  const unit = String(body.unit !== undefined ? body.unit : current?.unit || "").trim();
  if (!unit) throw invalid("TASK_UNIT_REQUIRED", "Indica la unidad del hábito");
  if (unit.length > UNIT_MAX) throw invalid("TASK_UNIT_TOO_LONG", `La unidad admite como mucho ${UNIT_MAX} caracteres`, { max: UNIT_MAX });

  const target = Number(body.target !== undefined ? body.target : current?.target);
  if (!Number.isFinite(target) || target <= 0) throw invalid("TASK_INVALID_TARGET", "El objetivo tiene que ser un número mayor que 0");
  const max = maxTargetFor(type, unit);
  if (target > max) throw invalid("TASK_TARGET_TOO_HIGH", `El objetivo no puede pasar de ${max}`, { max });

  const rawMax = body.targetMax !== undefined ? body.targetMax : current?.targetMax;
  const targetMax = present(rawMax) ? Number(rawMax) : null;
  if (targetMax !== null) {
    if (!Number.isFinite(targetMax) || targetMax <= target) {
      throw invalid("TASK_INVALID_RANGE", "El tope del rango tiene que ser mayor que el objetivo");
    }
    if (targetMax > max) throw invalid("TASK_TARGET_TOO_HIGH", `El objetivo no puede pasar de ${max}`, { max });
  }

  return { type, label: type === "custom" ? label : label || null, target, targetMax, unit };
}

// Mismo hábito = mismo tipo (y, si es propio, mismo nombre sin mayúsculas).
function sameHabit(a, b) {
  if (a.type !== b.type) return false;
  if (a.type !== "custom") return true;
  return String(a.label || "").trim().toLowerCase() === String(b.label || "").trim().toLowerCase();
}

module.exports = { LABEL_MAX, UNIT_MAX, maxTargetFor, parseTaskInput, sameHabit };
