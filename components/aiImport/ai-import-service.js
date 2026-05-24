const axios = require("axios");
const exerciseModel = require("../exercises/exercise-model");
const exerciseLibrary = require("./exercise-library");
const fewShotStore = require("./few-shot-store");

const DEEPSEEK_API_URL = "https://api.deepseek.com/v1/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const MAX_EXERCISES_IN_CONTEXT = 40;

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
  /rehabilitaci[oó]n/i, /nutricional/i, /^dieta/i, /planificador/i,
  /seguimiento/i, /^esquema/i, /^plantilla/i, /^programaci[oó]n$/i,
  /ejercicios\s*disponibles/i, /^plan\s/i, /^copia\s+de\s/i,
  // Nutrition / meal / food sheets
  /comid[ao]/i, /alimento/i, /alimentaci[oó]n/i, /nutrici[oó]n/i,
  /macros/i, /prote[ií]na/i, /carbohidrato/i, /grasa/i,
  /desayuno/i, /almuerzo/i, /cena/i, /merienda/i, /^menu/i,
  /^meal/i, /^food/i, /^nutrition/i, /receta/i, /ingrediente/i,
  /^tabla\s+intercambio/i, /^cant\.?$/i, /^mapping$/i,
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
  const seen = new Map();
  const dropped = new Set();
  for (const s of sheets) {
    const key = JSON.stringify((s.rows || []).slice(0, 10));
    if (seen.has(key)) {
      dropped.add(s.name);
    } else {
      seen.set(key, s.name);
    }
  }
  if (dropped.size > 0) {
    console.log(`[aiImport] Dedup dropped ${dropped.size} exact duplicate sheets`);
  }
  return sheets.filter(s => !dropped.has(s.name));
}

const WORKOUT_KEYWORDS =
  /series|sets|reps|repeticiones|ejercicio|exercise|rpe|rir|peso|weight|press|curl|squat|sentadilla|pull|push|d[ií]a|day|workout|entrenamiento|sesi[oó]n|bloque|semana|week/i;

const NON_WORKOUT_KEYWORDS =
  /grasa|prote[ií]na|carbohidrato|kcal|calor[ií]a|macros|receta|comid[ao]|cena|desayuno|almuerzo|merienda|alimento|ingrediente|dieta|nutrici[oó]n/i;

function scoreSheet(sheet) {
  let score = 0;
  const name = (sheet.name || "").toLowerCase();
  if (WORKOUT_KEYWORDS.test(name)) score += 10;
  if (NON_WORKOUT_KEYWORDS.test(name)) score -= 30;
  if (SKIP_SHEET_PATTERNS.some(p => p.test(name))) score -= 50;
  let checked = 0;
  for (const row of sheet.rows) {
    if (checked >= 30) break;
    if (!isRowMeaningful(row)) continue;
    checked++;
    const joined = row.join(" ");
    if (WORKOUT_KEYWORDS.test(joined)) score += 1;
    if (NON_WORKOUT_KEYWORDS.test(joined)) score -= 2;
  }
  return Math.max(score, 0);
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

// ── Column classification ──────────────────────────────────

const COL_ROW_NUM = /^(nº|n°|#|n\.|num|orden|order|item|ítem)$/i;
const COL_EXERCISE = /^(ejercicio|exercise|movimiento|movement|nombre|name|ejercicios|exercises)$/i;
const COL_IGNORE = /(comentario|nota|note|rendimiento|gestion|gestión|management|complejo\s+escapular|sesi[oó]n\s*\/\s*total|total|kcal|calorías|proteína|grasa|hc|carbohidrato|maping|mapping|alimento|comida|nutrición|boniato|patata|soja|preparación)/i;

/** Check if a cell value looks like workout set data (not a food item or comment) */
function looksLikeWorkoutData(val) {
  const v = String(val).trim().toLowerCase();
  if (!v) return false;
  return /^\d+[x×]\d+/i.test(v) ||              // "3x8"
    /\b(rir|rpe|fallo|drop|ds|rest)\b/i.test(v) || // RIR/RPE keywords
    /^\d+\.?\d*\s*-\s*\d+\.?\d*\s*$/i.test(v) || // "8-12"
    /^[\d.]+$/.test(v) && v.length >= 1;           // pure number (weight)
}

/** Check if a cell value looks like a food/nutrition item */
function looksLikeFood(val) {
  const v = String(val).trim().toLowerCase();
  if (!v) return false;
  return /^(arroz|pollo|huevo|avena|boniato|patata|soja|aceite|atún|pan|leche|yogur|pasta|carne|pescado|verdura|fruta|legumbre)/i.test(v)
    || /^\d+g\s/i.test(v)
    || /calor[ií]a|prot[eí]ina|grasa|carbo/i.test(v)
    || FOOD_KEYWORDS.test(v);
}

/**
 * Smart column detection: identify exercise name column and
 * ALL set data columns (SERIE 1, SERIE 2, etc.) — each one
 * represents a SET within each exercise.
 */
function findWorkoutColumns(rows) {
  if (!rows || rows.length < 2) return { nameIdx: 0, dataIdxs: [] };
  const numCols = Math.max(...rows.map(r => r.length));
  const headerRow = rows[0];

  let nameIdx = 0;
  for (let c = 0; c < headerRow.length; c++) {
    const h = String(headerRow[c] || "").trim().toLowerCase();
    if (COL_EXERCISE.test(h)) { nameIdx = c; break; }
    if (c === 0 && COL_ROW_NUM.test(h)) { nameIdx = 1; }
  }

  if (nameIdx === 0) {
    let nums = 0;
    for (let r = 1; r < Math.min(6, rows.length); r++) {
      if (/^\d+$/.test(String(rows[r][0] || "").trim())) nums++;
    }
    if (nums >= 4) nameIdx = 1;
  }

  const scored = [];
  for (let c = nameIdx + 1; c < numCols; c++) {
    let setPatterns = 0, rirRpe = 0, ranges = 0, hasWeight = 0, pureNums = 0, foodNums = 0, totalNonEmpty = 0;

    for (let r = 1; r < rows.length; r++) {
      const val = rows[r] && c < rows[r].length ? String(rows[r][c] || "").trim() : "";
      if (!val) continue;
      totalNonEmpty++;
      const v = val.toLowerCase();
      if (/^\d+[x×]\d+/i.test(v)) { setPatterns++; continue; }
      if (/\b(rir|rpe|fallo|drop|ds)\b/i.test(v)) { rirRpe++; continue; }
      if (/^\d+\s*-\s*\d+$/.test(v)) { ranges++; continue; }
      if (/\(\d+(\.\d+)?\)/.test(v)) { hasWeight++; continue; }
      if (/^\d+$/.test(v) && v.length <= 3) pureNums++;
      if (looksLikeFood(val)) foodNums++;
    }

    const quality = setPatterns * 10 + rirRpe * 8 + ranges * 4 + hasWeight * 3 + pureNums * 1;
    const effectiveTotal = totalNonEmpty - foodNums;
    if (effectiveTotal >= 2 && quality > 0) {
      scored.push({ col: c, quality });
    }
  }

  if (scored.length === 0) return { nameIdx, dataIdxs: [] };

  // Filter out columns that are clearly NOT set data (RPE, RIR, HC, notes, etc.)
  const setColumns = scored.filter(s => {
    const h = String(headerRow[s.col] || "").trim();
    const base = h.replace(/\s*\d+\s*$/, "").trim().toLowerCase();
    if (/^(rpe|rir|hc|nota|notas|peso|weight|comentario|serie\s*\/\s*rpe|serie\s*\/\s*rir)$/i.test(base)) return false;
    if (COL_IGNORE.test(h)) return false;
    if (COL_ROW_NUM.test(h)) return false;
    return true;
  });

  const cols = setColumns.length > 0 ? setColumns : scored;
  cols.sort((a, b) => a.col - b.col);
  return { nameIdx, dataIdxs: cols.map(s => s.col) };
}

const FOOD_KEYWORDS =
  /grasa|prote[ií]na|carbohidrato|kcal|calor[ií]a|macros|ingrediente|receta|comid[ao]|cena|desayuno|almuerzo|merienda/i;

/** Detect if a row is NOT an exercise (nutrition, metadata, header, etc.) */
function isNonExerciseRow(row, joined) {
  if (!joined) return false;
  // Obvious: rest/descanso rows
  if (/^descanso|^rest/i.test(joined)) return true;
  // Column headers within exercise sheet (ejercicio, series, reps, etc.)
  if (/^(ejercicio|exercise|series|sets|reps|repeticiones|peso|weight|rpe|rir|notas|observaciones)\s/i.test(joined)) return true;
  // Nutrition/food data
  if (FOOD_KEYWORDS.test(joined) || /^\d+g\s/.test(joined) || /\d+[k]?cal/i.test(joined)) return true;
  // Row with only numbers and simple labels in first column
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
    if (!rows || rows.length < 2) continue;

    const { nameIdx, dataIdxs } = findWorkoutColumns(rows);
    if (dataIdxs.length === 0) continue;

    const sections = splitByDiaHeaders(rows, nameIdx, dataIdxs);

    const workouts = [];
    for (const section of sections) {
      const exercises = [];
      for (const row of section.rows) {
        const name = nameIdx < row.length ? String(row[nameIdx] || "").trim() : "";
        if (!name) continue;

        const raws = dataIdxs
          .map(c => (c < row.length ? String(row[c] || "").trim() : ""))
          .filter(v => v);
        if (raws.length === 0) continue;

        exercises.push({ name, raw: raws.join(" | ") });
      }
      if (exercises.length > 0) {
        workouts.push({
          name: section.name || sheet.name,
          exercises,
        });
      }
    }

    if (workouts.length > 0) {
      result.push({
        name: sheet.name,
        workouts,
      });
    }
  }
  return result;
}

/**
 * Split rows into sections based on DIA / DAY headers.
 * Each DIA header starts a new section; all following exercise
 * rows belong to that section until the next DIA header.
 * If no DIA headers are found, returns a single section with all rows.
 */
const GENERIC_WORKOUT_NAMES = /^(ejercicio|exercise|serie|set|reps|repeticiones|peso|weight|nota|notes|observaciones)$/i;

function splitByDiaHeaders(rows, nameIdx, dataIdxs) {
  const hasDiaHeaders = rows.slice(1).some(r => Array.isArray(r) && isDiaHeader(r));
  const sections = [];
  let current = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    if (isDiaHeader(row)) {
      if (current && current.rows.length > 0) sections.push(current);
      const rawName = getDiaName(row);
      const name = (rawName && !GENERIC_WORKOUT_NAMES.test(rawName)) ? rawName : `DIA ${sections.length + 1}`;
      current = { name, rows: [] };
      continue;
    }

    // Skip non-exercise rows
    const joined = row.join(" ").trim().toLowerCase();
    if (!joined) continue;
    if (joined.startsWith("semana ") || joined.startsWith("week ")) continue;
    if (isNonExerciseRow(row, joined)) continue;

    const name = nameIdx < row.length ? String(row[nameIdx] || "").trim() : "";
    if (!name) continue;
    if (/^(nº|n°|#|total|subtotal|ejercicio|exercise|promedio|average|media|rango|range)$/i.test(name)) continue;
    if (looksLikeFood(name)) continue;

    if (!current) current = { name: null, rows: [] };
    current.rows.push(row);
  }

  if (current && current.rows.length > 0) sections.push(current);

  // If no DIA rows, squash everything into one section
  if (!hasDiaHeaders && sections.length > 0) {
    const allRows = sections.flatMap(s => s.rows);
    return [{ name: null, rows: allRows }];
  }

  // Name sections that fell through with null names
  for (const s of sections) {
    if (!s.name) s.name = `DIA ${sections.indexOf(s) + 1}`;
  }

  return sections;
}

// ── Name matching helpers ──────────────────────────────────

/** Simple fuzzy: true if every word in query appears in target */
function fuzzyMatch(query, target) {
  const qWords = query.toLowerCase().split(/[\s,._\-]+/).filter(Boolean);
  const tStr = target.toLowerCase();
  return qWords.every(w => tStr.includes(w));
}

/** Extract unique exercise names from preview splits */
function extractSplitExerciseNames(preview) {
  const names = new Set();
  for (const split of preview) {
    for (const wo of (split.workouts || [])) {
      for (const ex of (wo.exercises || [])) {
        if (ex.name) names.add(ex.name.trim());
      }
    }
  }
  return [...names];
}

/** Score how well a library exercise matches a raw name */
function matchScore(rawName, libEx) {
  const n = (libEx.n || "").toLowerCase();
  const k = (libEx.k || []).map(s => s.toLowerCase());
  const raw = rawName.toLowerCase();
  // Direct name match = highest
  if (n === raw) return 100;
  if (n.includes(raw) || raw.includes(n)) return 80;
  // Word-level fuzzy
  const qWords = raw.split(/[\s,._\-]+/).filter(Boolean);
  const nWords = n.split(/[\s,._\-]+/).filter(Boolean);
  const matchCount = qWords.filter(w => nWords.includes(w)).length;
  if (matchCount >= 2) return 50 + matchCount * 5;
  if (matchCount === 1) return 20;
  // Keyword match
  const kMatch = qWords.filter(w => k.includes(w)).length;
  if (kMatch >= 2) return 30 + kMatch * 5;
  if (kMatch === 1) return 10;
  return 0;
}

// ── Prompt building ────────────────────────────────────────

function buildExerciseContext(dbExercises, preview) {
  const library = exerciseLibrary || [];
  const merged = [];
  const seen = new Set();

  // 1. DB exercises first
  for (const e of dbExercises) {
    merged.push({ _id: e._id.toString(), n: e.name, m1: e.muscleGroups1 || [], c: e.category || [], k: e.keywords || [] });
    seen.add(e.name.toLowerCase());
    if (merged.length >= MAX_EXERCISES_IN_CONTEXT) return merged;
  }

  // 2. Find which library exercises match names in the current split
  const rawNames = extractSplitExerciseNames(preview || []);
  const scored = library
    .filter(e => !seen.has((e.n || "").toLowerCase()))
    .map(e => ({
      ex: e,
      score: Math.max(...rawNames.map(r => matchScore(r, e)), 0),
    }))
    .sort((a, b) => b.score - a.score);

  // 3. Matched exercises first, then fill with remaining
  for (const { ex: e } of scored) {
    if (merged.length >= MAX_EXERCISES_IN_CONTEXT) break;
    const key = (e.n || "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({ _id: null, n: e.n, m1: [], c: [], k: e.k || [] });
  }

  return merged;
}

function buildSplitPrompt(split, tableName, fileName, exerciseContext) {
  const splitStr = JSON.stringify(split, null, 1);
  const fewShot = fewShotStore.getTop(30);

  let fewShotStr = "";
  if (fewShot.length > 0) {
    fewShotStr = "\nExamples of raw→sets parsing from previous imports:\n" +
      fewShot.map((ex, i) =>
        `  "${ex.raw}" → ${JSON.stringify(ex.p)}`
      ).join("\n") + "\n";
  }

  return `File:${fileName||"?"} Table:${tableName} Split:"${split.name}"

INSTRUCTIONS:
1. ONLY process exercise data. IGNORE nutrition, food, body measurements, etc.
2. Parse each exercise's raw text into a sets array "s".
3. Match each exercise by NAME to the Exercises list below.
4. If NOT in the list, infer muscle groups + category from the name.

PARSE raw text → "s" array (one entry per set):
- "10-12 | 10-12 | 8-10" → s:[{reps:[10,12]},{reps:[10,12]},{reps:[8,10]}]  (pipe = multiple sets)
- "3x8 RIR2(67.5)" → s:[{reps:[8],rir:[2],w:67.5},{reps:[8],rir:[2],w:67.5},{reps:[8],rir:[2],w:67.5}]
- "8-12" → s:[{reps:[8,12]}]
- "FALLO" → s:[{rir:[-1]}]
- "drop/DS" → d:true
- "RP 20s" → rp:20
- "67.5" → w:67.5  (single decimal number > 20 = weight, NOT reps)
- "67.5 | 70 | 72.5" → s:[{w:67.5},{w:70},{w:72.5}]  (decimal = weight, not reps)${fewShotStr}

MATCH each exercise by NAME to the Exercises list:
- If name matches (case-insensitive, partial OK), set id:match._id and create:false.
- Same exercise in MULTIPLE workouts → use SAME id for all occurrences.
- If name is NOT in the list at all → set id:null, create:true AND ALWAYS include ed:{n:(exact name), m1:[muscle groups], m2:[], c:[category], eq:[equipment], cardio:false}.
  INFER muscle groups and category from the name using these patterns:
    CURL / BICEP / BÍCEPS → m1:["Bíceps"] c:["Curl"]
    PRESS / PECTORAL / PECHO → m1:["Pectoral","Deltoides anterior","Tríceps"] c:["Empuje horizontal"]
    SENTADILLA / SQUAT / HACK / PRENSA → m1:["Cuádriceps","Femoral","Glúteo"] c:["Sentadilla"]
    REMO / ROW / JALÓN / PULL → m1:["Espalda","Bíceps"] c:["Remo"]
    ELEVACIONES / LATERAL / DELTOIDES → m1:["Deltoides lateral"] c:["Elevaciones laterales"]
    TRICEPS / EXTENSIÓN → m1:["Tríceps"] c:["Extensiones"]
    ABDOMINAL / CRUNCH / CORE → m1:["Abdominales"] c:["Core"]
    FEMORAL / CURL FEMORAL / LEG CURL → m1:["Femoral"] c:["Curl femoral"]
    CUÁDRICEPS / CUADS / EXTENSIÓN CUÁDRICEPS → m1:["Cuádriceps"] c:["Extensiones de cuádriceps"]
    GEMELO / TALÓN / CALF / ELEVACIONES TALÓN → m1:["Gemelo"] c:["Elevaciones de talones"]
    ADUCTOR / ADUCCIONES → m1:["Aductor"] c:["Aducciones"]
    ABDUCTOR / ABDUCCIONES → m1:["Abductor"] c:["Abducciones"]
    PESO MUERTO / RUMANO / DEADLIFT → m1:["Femoral","Glúteo","Espalda baja"] c:["Peso muerto"]
    GLÚTEO / HIP THRUST / PATADA → m1:["Glúteo"] c:["Glúteo"]
    HOMBRO / MILITAR / OVERHEAD → m1:["Deltoides anterior","Deltoides lateral"] c:["Press militar"]
    DOMINADA / CHINUP / PULL-UP → m1:["Espalda","Bíceps"] c:["Dominadas"]
    FONDOS / DIPS → m1:["Pectoral","Tríceps","Deltoides anterior"] c:["Fondos"]

Return JSON:
{n:"splitName", workouts:[{n:"workoutName", exercises:[{n:"exName", id:matchIdOrNull, create:trueOrFalse, ed:{...}(only if create), s:[{reps:[...], rir:[...], w:num}]}]}]}

Exercises list:
${JSON.stringify(exerciseContext)}

Split data:
${splitStr}`;
}

function remapExercise(ex) {
  if (!ex) return ex;
  return {
    name: ex.n || ex.name,
    matchedExerciseId: ex.id ?? ex._id ?? null,
    shouldCreate: ex.create === true,
    exerciseData: ex.ed ? {
      name: ex.ed.n || ex.ed.name,
      muscleGroups1: ex.ed.m1 || ex.ed.muscleGroups1 || [],
      muscleGroups2: ex.ed.m2 || ex.ed.muscleGroups2 || [],
      category: ex.ed.c || ex.ed.category || [],
      equipment: ex.ed.eq || ex.ed.equipment || [],
      isCardio: ex.ed.cardio || false,
    } : undefined,
    sets: (ex.s || ex.sets || []).map((set) => ({
      expectedReps: set.reps,
      expectedRir: set.rir,
      weight: typeof set.w === "number" ? set.w : undefined,
      drop: set.d === true || set.d === "true" || false,
      restPause: set.rp ?? null,
      expectedMin: set.min ?? null,
      expectedSec: set.sec ?? null,
    })),
  };
}

function remapAiResponse(data) {
  if (!data) return data;
  return {
    name: data.n || data.name,
    splits: (data.splits || []).map((split) => ({
      name: split.n || split.name,
      workouts: (split.workouts || []).map((wo) => ({
        name: wo.n || wo.name,
        exercises: (wo.exercises || []).map(remapExercise),
      })),
    })),
  };
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
          content: `You are a workout parser. ONLY process exercise data: splits, workouts, exercises, sets. IGNORE nutrition, meals, food, macros, calories, body measurements, or any other non-exercise data. Output JSON with n (name), id (matched ID or null), create (true if new), s (sets array with reps,rir,w,d,rp). IMPORTANT: decimal numbers like 67.5 are WEIGHTS (w), NOT split into reps [67,5]. Interpret a pure number without context as weight if > 20, or if it has a decimal point.`,
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 16384,
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

// ── Few-shot capture ───────────────────────────────────────
function captureFewShotPairs(preview, splitResults) {
  const examples = [];
  for (let s = 0; s < preview.length; s++) {
    const rawWorkouts = preview[s].workouts || [];
    const parsedWorkouts = splitResults[s]?.workouts || [];
    for (let w = 0; w < rawWorkouts.length; w++) {
      const rawExs = rawWorkouts[w].exercises || [];
      const parsedExs = parsedWorkouts[w]?.exercises || [];
      for (let e = 0; e < rawExs.length; e++) {
        const raw = rawExs[e].raw;
        const sets = parsedExs[e]?.s || [];
        if (raw && sets.length > 0) {
          const p = sets.map((set) => [
            set.reps?.[0] ?? null,
            set.reps?.[1] ?? set.reps?.[0] ?? null,
            set.rir?.[0] ?? null,
            set.rir?.[1] ?? set.rir?.[0] ?? null,
            set.w ?? null,
          ]);
          examples.push({ raw, p });
        }
      }
    }
  }
  return examples;
}

// ── Main ───────────────────────────────────────────────────

async function interpretExcel(sheets, fileName) {
  try {
    const exercises = await exerciseModel.getExercises(0, 10000);
    const truncated = truncateSheets(sheets);
    const preview = buildStructuredPreview(truncated);
    const exerciseContext = buildExerciseContext(exercises, preview);
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

    const captured = captureFewShotPairs(preview, splitResults);
    if (captured.length > 0) {
      fewShotStore.append(captured);
      console.log(`[aiImport] Captured ${captured.length} few-shot examples`);
    }

    const assembled = preview.map((originalSplit, idx) => {
      const result = splitResults[idx];
      if (result && (result.workouts || result.n)) {
        return result;
      }
      return { n: originalSplit.name, workouts: originalSplit.workouts };
    });

    const full = { n: tableName, splits: assembled };
    return remapAiResponse(full);
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