/**
 * Parse a raw set string into structured { reps, rir, w, d, rp }.
 * Handles common patterns from Excel imports.
 */
function parseRawSet(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  const result = { reps: null, rir: null, w: null, d: false, rp: null };

  // FALLO → rir: -1
  if (/^fallo$/i.test(s)) {
    result.rir = [-1];
    return result;
  }

  // drop / DS
  if (/\b(?:drop|ds|dropset)\b/i.test(s)) result.d = true;

  // RP"Xs" or RP"X" or RPX
  const rpM = s.match(/RP\s*"?(\d+)"?\s*s/i);
  if (rpM) result.rp = parseInt(rpM[1], 10);

  // RIR[space]N or RIRN
  const rirM = s.match(/RIR\s*(\d+)/i);
  if (rirM) {
    const v = parseInt(rirM[1], 10);
    result.rir = [v, v];
  }

  // (weight)
  const wM = s.match(/\((\d+(?:\.\d+)?)\)/);
  if (wM) result.w = parseFloat(wM[1]);

  // N x M1-M2 or N x M
  const repsM = s.match(/(\d+)\s*x\s*(\d+)(?:\s*[-–]\s*(\d+))?/i);
  if (repsM) {
    const n = parseInt(repsM[1], 10);
    const lo = parseInt(repsM[2], 10);
    const hi = repsM[3] ? parseInt(repsM[3], 10) : lo;
    const arr = Array.from({ length: n }, () => [lo, hi]);
    result.reps = arr;
    return result;
  }

  // bare "M1-M2" (single set)
  const rangeM = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (rangeM) {
    result.reps = [[parseInt(rangeM[1], 10), parseInt(rangeM[2], 10)]];
    return result;
  }

  // bare "M" (single set, single rep number)
  const singleM = s.match(/^(\d+)$/);
  if (singleM) {
    const v = parseInt(singleM[1], 10);
    result.reps = [[v, v]];
    return result;
  }

  return result;
}

module.exports = { parseRawSet };
