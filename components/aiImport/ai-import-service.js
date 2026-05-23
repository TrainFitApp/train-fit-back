const axios = require("axios");
const exerciseModel = require("../exercises/exercise-model");

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const MAX_EXERCISES_IN_CONTEXT = 300;

function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {}

  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch (_) {}
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }

  return null;
}

// ── Filtering constants ────────────────────────────────────
const MAX_TOTAL_ROWS = 800;
const MAX_ROWS_PER_SHEET = 150;
const MAX_SHEETS = 8;
const MIN_NON_EMPTY_CELLS_PER_ROW = 2;

const SKIP_SHEET_PATTERNS = [
  /presentaci[oó]n/i, /inicio/i, /^e-?books?$/i, /comparaci[oó]n/i,
  /instrucciones/i, /^config/i, /^info$/i, /^links?$/i, /^portada$/i,
  /^[ií]ndice$/i, /^indice$/i, /calentamiento/i, /intensidad/i,
  /^rpe/i, /^rir/i, /antropometr[ií]a/i, /^datos/i,
  /rehabilitaci[oó]n/i, /nutricional/i, /^dieta$/i, /planificador/i,
  /seguimiento/i, /^esquema/i, /^plantilla/i, /^programaci[oó]n$/i,
  /ejercicios\s*disponibles/i, /^plan\s/i, /^copia\s+de\s/i,
];

function isRowMeaningful(row) {
  if (!Array.isArray(row)) return false;
  let n = 0;
  for (const c of row) {
    if (c !== "" && c !== null && c !== undefined && ++n >= MIN_NON_EMPTY_CELLS_PER_ROW) return true;
  }
  return false;
}

function shouldSkipSheet(name) {
  return SKIP_SHEET_PATTERNS.some((p) => p.test(name.trim()));
}

const REPEATED_PATTERN = /^(.*?)(\d+)\s*$/;
const CYCLE_KEYWORDS = /semana|week|ciclo|cycle|mes|month|bloque|block|fase|phase|w\d|s\d|m\d/i;

function deduplicateWeeklySheets(sheets) {
  const groups = new Map();
  for (const s of sheets) {
    const m = s.name.trim().match(REPEATED_PATTERN);
    if (m && CYCLE_KEYWORDS.test(m[1])) {
      const base = m[1].trim().toLowerCase();
      const n = parseInt(m[2], 10);
      if (!groups.has(base)) groups.set(base, []);
      groups.get(base).push({ sheet: s, number: n });
    }
  }
  const dropped = new Set();
  for (const [, entries] of groups) {
    if (entries.length >= 3) {
      entries.sort((a, b) => b.number - a.number);
      for (let i = 1; i < entries.length; i++) dropped.add(entries[i].sheet.name);
      console.log(`[aiImport] Dedup "${entries[0].sheet.name}" kept, dropped ${entries.length - 1}`);
    }
  }
  return sheets.filter((s) => !dropped.has(s.name));
}

const WORKOUT_KEYWORDS =
  /series|sets|reps|repeticiones|ejercicio|exercise|rpe|rir|peso|weight|press|curl|squat|sentadilla|pull|push|d[ií]a|day|workout|entrenamiento|sesi[oó]n|bloque|semana|week/i;

function scoreSheet(sheet) {
  let score = 0;
  if (WORKOUT_KEYWORDS.test((sheet.name || "").toLowerCase())) score += 10;
  let checked = 0;
  for (const row of sheet.rows) {
    if (checked >= 30) break;
    if (!isRowMeaningful(row)) continue;
    checked++;
    if (WORKOUT_KEYWORDS.test(row.join(" "))) score += 1;
  }
  return score;
}

function truncateSheets(sheets) {
  let candidates = sheets.filter((s) => !shouldSkipSheet(s.name));
  if (candidates.length === 0) candidates = [...sheets];
  candidates = deduplicateWeeklySheets(candidates);
  const cleaned = candidates.map((s) => ({
    name: s.name,
    rows: s.rows.filter(isRowMeaningful).slice(0, MAX_ROWS_PER_SHEET),
  })).filter((s) => s.rows.length >= 3);
  for (const s of cleaned) s._score = scoreSheet(s);
  cleaned.sort((a, b) => b._score - a._score);
  const capped = cleaned.slice(0, MAX_SHEETS);
  const result = [];
  let total = 0;
  for (const s of capped) {
    if (total >= MAX_TOTAL_ROWS) break;
    const rows = s.rows.slice(0, MAX_TOTAL_ROWS - total);
    result.push({ name: s.name, rows });
    total += rows.length;
  }
  return result;
}

// ── Structure detection ─────────────────────────────────────

/** Detect if a row is a DIA/DAY header */
function isDiaHeader(row) {
  return row.some((c) => typeof c === "string" && /^(d[ií]a|day)\s*\d+/i.test(c.trim()));
}

/** Extract the day name (e.g. "EMPUJE" from row ["","","DIA 1","EMPUJE",...]) */
function getDiaName(row) {
  const diaCell = row.find((c) => typeof c === "string" && /^(d[ií]a|day)\s*\d+/i.test(c.trim()));
  if (!diaCell) return "";
  const idx = row.indexOf(diaCell);
  const name = row.slice(idx + 1).find((c) => typeof c === "string" && c.trim());
  return (name || "").trim();
}

/**
 * Detect split/cycle labels from column headers.
 * Looks for ANY row where 2+ consecutive cells contain label-like text
 * (semana, ciclo, micro, mes, bloque, week, phase, block, etc. or just "1", "2", "3"...).
 * This is label-agnostic — works with any naming convention.
 */
function detectSplitLabels(rows) {
  for (const row of rows) {
    // Skip rows that are DIA/DAY workout headers (not column headers)
    if (row.some((c) => typeof c === "string" && /^(d[ií]a|day)\s*\d+/i.test(c.trim()))) continue;
    // Scan for a run of 2+ cells that look like column labels
    let labels = [];
    for (const cell of row) {
      const s = String(cell ?? "").trim().toLowerCase();
      // Consider it a label if: non-empty, not too long, not a pure number alone
      // (pure numbers only count if preceded by another label)
      const isLabel = s && s.length < 40 &&
        !/^\d+$/.test(s) &&
        !/^[•··,;.\-]+$/.test(s);
      if (isLabel) {
        labels.push(String(cell).trim());
      } else if (s && /^\d+$/.test(s) && labels.length >= 1) {
        // Number-only cells count if we already have a label
        labels.push(s);
      } else if (labels.length >= 2) {
        // We found our header row
        break;
      } else {
        labels = [];
      }
    }
    if (labels.length >= 2) return labels;
  }
  // Fallback: infer number of splits from data pattern.
  // Count how many consecutive columns (starting at index 1) have data in exercise rows.
  const colCounts = {};
  for (const row of rows) {
    let count = 0;
    for (let c = 1; c < row.length; c++) {
      if (String(row[c] ?? "").trim()) count++;
      else break;
    }
    if (count >= 2) colCounts[count] = (colCounts[count] || 0) + 1;
  }
  const best = Object.entries(colCounts).sort((a, b) => b[1] - a[1]);
  if (best.length > 0) {
    const num = parseInt(best[0][0]);
    return Array.from({ length: num }, (_, i) => `Ciclo ${i + 1}`);
  }
  return [];
}

/** Detect if a row looks like a column header / metadata (not an exercise) */
function isNonExerciseRow(row, joined) {
  if (/descanso|rest|^descan/i.test(joined)) return true;
  if (!row[0] || !String(row[0]).trim()) {
    const nonEmpty = row.filter((c) => String(c ?? "").trim());
    if (nonEmpty.length <= 2 && /^[a-zñáéíóú\s]+\s+\d+(\s+\d+)?$/i.test(joined)) return true;
  }
  return false;
}

/**
 * Backend detects the full hierarchical structure:
 * Split[week] → Workout[day] → Exercise[name, rawStringsPerWeek[]]
 * The AI only needs to parse raw strings and match exercises.
 */
function buildStructuredPreview(sheets) {
  const result = [];

  for (const sheet of sheets) {
    const rows = sheet.rows;
    const weeklyLabels = detectSplitLabels(rows);
    const numWeeks = weeklyLabels.length >= 2 ? weeklyLabels.length : 1;
    const splitNames = weeklyLabels.length >= 2 ? weeklyLabels : ["Split único"];

    // Find DIA headers and group exercises
    const diaGroups = [];
    let currentGroup = null;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!Array.isArray(row)) continue;
      const joined = row.join(" ").trim().toLowerCase();

      if (isDiaHeader(row)) {
        if (currentGroup) diaGroups.push(currentGroup);
        currentGroup = { header: row.find((c) => /^(d[ií]a|day)\s*\d+/i.test(String(c).trim())), name: getDiaName(row), exercises: [] };
        continue;
      }

      if (joined.startsWith("semana") || joined.startsWith("week")) continue;
      if (isNonExerciseRow(row, joined)) continue;
      if (row.every((c) => !c || (typeof c === "string" && !c.trim()))) continue;

      const name = String(row[0] || "").trim();
      if (!name) continue;

      // Get weekly data from columns 1..numWeeks
      const weeklyData = [];
      for (let w = 0; w < numWeeks; w++) {
        weeklyData.push(String(row[w + 1] || "").trim());
      }

      const exercise = { name, raw: weeklyData };
      if (currentGroup) {
        currentGroup.exercises.push(exercise);
      }
    }
    if (currentGroup) diaGroups.push(currentGroup);

    // If no DIA markers found, treat the whole sheet as one workout
    if (diaGroups.length === 0) {
      const exercises = [];
      for (const row of rows) {
        const joined = row.join(" ").trim().toLowerCase();
        if (joined.startsWith("semana") || joined.startsWith("week")) continue;
        if (isNonExerciseRow(row, joined)) continue;
        if (row.every((c) => !c || (typeof c === "string" && !c.trim()))) continue;
        const name = String(row[0] || "").trim();
        if (!name) continue;
        const weeklyData = [];
        for (let w = 0; w < numWeeks; w++) {
          weeklyData.push(String(row[w + 1] || "").trim());
        }
        exercises.push({ name, raw: weeklyData });
      }
      if (exercises.length > 0) {
        diaGroups.push({ header: "Workout", name: sheet.name, exercises });
      }
    }

    // Build the tree: splits = weeks, workouts = DIA groups
    const allWorkoutNames = diaGroups.map((g) => g.header + (g.name ? " - " + g.name : ""));
    const workouts = diaGroups.map((g) => ({
      name: g.header + (g.name ? " - " + g.name : ""),
      shortName: g.name || g.header,
      exercises: g.exercises,
    }));

    for (let w = 0; w < splitNames.length; w++) {
      const split = {
        name: splitNames[w],
        workouts: workouts.map((wo) => ({
          name: wo.shortName,
          exercises: wo.exercises.map((ex) => ({
            name: ex.name,
            raw: ex.raw[w] || "",
          })).filter((ex) => ex.raw),
        })).filter((wo) => wo.exercises.length > 0),
      };
      if (split.workouts.length > 0) {
        result.push(split);
      }
    }
  }
  return result;
}

// ── Prompt building ────────────────────────────────────────

function buildExerciseContext(exercises) {
  return exercises.slice(0, MAX_EXERCISES_IN_CONTEXT).map((e) => ({
    _id: e._id.toString(),
    n: e.name,
    m1: e.muscleGroups1 || [],
    m2: e.muscleGroups2 || [],
    c: e.category || [],
    eq: e.equipment || [],
    cardio: e.isCardio || false,
  }));
}

function buildSplitPrompt(split, tableName, fileName, exerciseContext) {
  const splitStr = JSON.stringify(split, null, 1);

  return `Archivo: "${fileName || "desconocido"}", Tabla: "${tableName}"

Procesa el split "${split.name}" con sus workouts y ejercicios.

## Tarea para CADA ejercicio:
1. Parsea el texto "raw" → sets en formato TrainFit:
   - "3x8 RIR 2 (67.5 kg)" → 3 sets, expectedReps:[8,8], expectedRir:[2,2], weight:67.5
   - "2X12 RIR 2 + 2X13 RIR 1" → dos grupos de sets
   - "8-12" → [8,12], "RIR 2-1" → [1,2]
   - RPE→RIR: RIR = 10 - RPE
   - "FALLO" → expectedRir:[-1]
   - Sin RPE/RIR → default expectedRir:[2,3]
   - drop: true si "drop"/"DS"/"dropset"
   - restPause: "RP 20s" → 20, "RP 1min" → 60
   - Cardio: expectedMin/expectedSec

2. Match contra DB (campo "n"): >80% → matchedExerciseId:_id, shouldCreate:false. Si no → matchedExerciseId:null, shouldCreate:true, infiere datos.

## Ejercicios en DB:
${JSON.stringify(exerciseContext)}

## Split a procesar:
${splitStr}

Devuelve SOLO este split con los ejercicios completados (name, matchedExerciseId, shouldCreate, exerciseData, sets).`;
}

async function callDeepSeek(prompt) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY no configurada en .env");

  const response = await axios.post(
    DEEPSEEK_API_URL,
    {
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: "system",
          content: `Completa estructuras JSON de entrenamiento. SIGUE EXACTAMENTE la estructura. Añade: matchedExerciseId, shouldCreate, exerciseData, sets. Formato sets: {expectedReps:[min,max],expectedRir:[min,max],weight:number,drop:bool,restPause:number|null,expectedMin:null,expectedSec:null}. Solo JSON, sin markdown.`,
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 65536,
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 180000,
    }
  );

  const choice = response.data?.choices?.[0];
  const content = choice?.message?.content;
  const finishReason = choice?.finish_reason || "unknown";

  if (!content) {
    throw new Error(`DeepSeek no generó contenido. Finish reason: ${finishReason}`);
  }
  if (finishReason === "length") {
    console.warn("[aiImport] WARNING: Response was truncated by max_tokens limit!");
  }

  const parsed = extractJson(content);
  if (!parsed) {
    console.error("[aiImport] Raw response (first 500):", content.slice(0, 500));
    throw new Error(`No se pudo extraer JSON (finishReason: ${finishReason})`);
  }
  return parsed;
}

// ── Main ───────────────────────────────────────────────────

async function interpretExcel(sheets, fileName) {
  try {
    const exercises = await exerciseModel.getExercises(0, 10000);
    const exerciseContext = buildExerciseContext(exercises);
    const truncated = truncateSheets(sheets);
    const preview = buildStructuredPreview(truncated);
    const tableName = fileName || "Tabla sin nombre";

    console.log(`[aiImport] Sheets: ${sheets.length} → ${truncated.length}, Splits: ${preview.length}`);
    for (const sp of preview) {
      console.log(`[aiImport]   Split "${sp.name}": ${sp.workouts.length} workouts, ${sp.workouts.reduce((s, w) => s + w.exercises.length, 0)} exercises`);
    }

    if (preview.length === 0) {
      return { name: tableName, splits: [] };
    }

    // Process each split in parallel
    const splitPromises = preview.map((split) => {
      const prompt = buildSplitPrompt(split, tableName, fileName, exerciseContext);
      console.log(`[aiImport]   → Calling DeepSeek for "${split.name}": ${split.workouts.reduce((s, w) => s + w.exercises.length, 0)} exercises, prompt ${(prompt.length / 1024).toFixed(1)}KB`);
      return callDeepSeek(prompt);
    });

    const splitResults = await Promise.all(splitPromises);

    console.log(`[aiImport] All ${splitResults.length} splits processed successfully`);

    // Assemble: use the names from the original preview, data from DeepSeek responses
    const assembled = preview.map((originalSplit, idx) => {
      const result = splitResults[idx];
      // DeepSeek should return the split with completed exercises
      // If it returned a full response with a "name" field, use it directly
      if (result && result.name && result.workouts) {
        return { name: result.name, workouts: result.workouts };
      }
      // Fallback: use original structure with empty exercises
      return { name: originalSplit.name, workouts: originalSplit.workouts };
    });

    return { name: tableName, splits: assembled };
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const msg = error.response.data?.error?.message || error.response.data?.error?.status || error.message;
      throw new Error(`DeepSeek API error [${status}]: ${msg || JSON.stringify(error.response.data).slice(0, 200)}`);
    }
    throw error;
  }
}

module.exports = { interpretExcel };