const fs = require("fs");
const path = require("path");

const ENV_PATH = path.resolve(__dirname, "../../.env");

function parseFile() {
  if (!fs.existsSync(ENV_PATH)) return [];
  const content = fs.readFileSync(ENV_PATH, "utf8");
  return content.split("\n").map((raw) => {
    const trimmed = raw.trim();

    if (!trimmed) return { type: "blank", raw };

    if (trimmed.startsWith("#")) {
      const match = trimmed.match(/^#\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
      if (match)
        return {
          type: "entry",
          key: match[1],
          value: match[2],
          commented: true,
          raw,
        };
      return { type: "comment", raw };
    }

    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (match)
      return {
        type: "entry",
        key: match[1],
        value: match[2],
        commented: false,
        raw,
      };

    return { type: "other", raw };
  });
}

function writeFile(lines) {
  const content = lines.map((l) => l.raw).join("\n");
  fs.writeFileSync(ENV_PATH, content, "utf8");
}

function getEntries() {
  const lines = parseFile();
  return lines.filter((l) => l.type === "entry").map(({ key, value, commented }) => ({ key, value, commented }));
}

function addEntry(key, value) {
  const lines = parseFile();
  lines.push({ type: "entry", key, value, commented: false, raw: `${key}=${value}` });
  writeFile(lines);
  return { key, value, commented: false };
}

function updateEntry(key, value) {
  const lines = parseFile();
  const entry = lines.find((l) => l.type === "entry" && l.key === key);
  if (!entry) return null;
  entry.value = value;
  entry.raw = entry.commented ? `#${entry.key}=${value}` : `${entry.key}=${value}`;
  writeFile(lines);
  return { key, value, commented: entry.commented };
}

function toggleEntry(key) {
  const lines = parseFile();
  const entry = lines.find((l) => l.type === "entry" && l.key === key);
  if (!entry) return null;
  entry.commented = !entry.commented;
  entry.raw = entry.commented ? `#${entry.key}=${entry.value}` : `${entry.key}=${entry.value}`;
  writeFile(lines);
  return { key: entry.key, value: entry.value, commented: entry.commented };
}

function deleteEntry(key) {
  const lines = parseFile();
  const idx = lines.findIndex((l) => l.type === "entry" && l.key === key);
  if (idx === -1) return false;
  lines.splice(idx, 1);
  writeFile(lines);
  return true;
}

// ─── DB profile grouping ─────────────────────────────────────────────────

function groupIntoBlocks(lines) {
  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line.type === "blank") {
      if (current.length) {
        blocks.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function isDbBlock(block) {
  return block.some((l) => l.type === "entry" && l.key && l.key.startsWith("MONGODB_"));
}

function getDbProfiles() {
  const lines = parseFile();
  const blocks = groupIntoBlocks(lines);
  const profiles = [];

  for (const block of blocks) {
    if (!isDbBlock(block)) continue;
    const nameEntry = block.find((l) => l.type === "entry" && l.key === "MONGODB_DB");
    if (!nameEntry) continue;
    const isActive = block.some((l) => l.type === "entry" && !l.commented && l.key.startsWith("MONGODB_"));
    profiles.push({ name: nameEntry.value, isActive });
  }

  return profiles;
}

function switchDbProfile(targetName) {
  const lines = parseFile();
  const blocks = groupIntoBlocks(lines);
  let targetBlock = null;
  let activeBlock = null;

  for (const block of blocks) {
    if (!isDbBlock(block)) continue;
    const nameEntry = block.find((l) => l.type === "entry" && l.key === "MONGODB_DB");
    if (!nameEntry) continue;
    const isActive = block.some((l) => l.type === "entry" && !l.commented && l.key.startsWith("MONGODB_"));
    if (nameEntry.value === targetName) targetBlock = block;
    if (isActive) activeBlock = block;
  }

  if (!targetBlock) return { success: false, message: `Profile "${targetName}" not found` };
  if (targetBlock === activeBlock) return { success: false, message: "Already on this profile" };

  // Comment all lines in active block
  for (const line of activeBlock) {
    if (line.type === "entry" && !line.commented) {
      line.commented = true;
      line.raw = `#${line.key}=${line.value}`;
    }
  }

  // Uncomment all lines in target block
  for (const line of targetBlock) {
    if (line.type === "entry" && line.commented) {
      line.commented = false;
      line.raw = `${line.key}=${line.value}`;
    }
  }

  writeFile(lines);
  return { success: true };
}

module.exports = { getEntries, addEntry, updateEntry, toggleEntry, deleteEntry, getDbProfiles, switchDbProfile };
