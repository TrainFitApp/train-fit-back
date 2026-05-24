const fs = require("fs");
const path = require("path");

const MAX_EXAMPLES = 200;
const FILE_PATH = path.join(__dirname, "few-shot-examples.json");

let _cache = null;

function load() {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(FILE_PATH, "utf8").trim();
    _cache = raw ? JSON.parse(raw) : [];
  } catch {
    _cache = [];
  }
  return _cache;
}

function getTop(n) {
  return load().slice(-n);
}

function append(examples) {
  if (!examples || examples.length === 0) return;
  const all = load();
  all.push(...examples);
  const trimmed = all.slice(-MAX_EXAMPLES);
  try {
    fs.writeFileSync(FILE_PATH, JSON.stringify(trimmed, null, 1));
    _cache = trimmed;
  } catch (err) {
    console.error("[fewShot] Failed to write:", err.message);
  }
}

module.exports = { load, getTop, append };
