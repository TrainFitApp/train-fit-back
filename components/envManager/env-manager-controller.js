const service = require("./env-manager-service");

async function list(req, res) {
  try {
    const entries = service.getEntries();
    res.json({ success: true, entries });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function create(req, res) {
  try {
    const { key, value } = req.body;
    if (!key || !/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      return res.status(400).json({ success: false, message: "Invalid key format" });
    }
    const existing = service.getEntries().find((e) => e.key === key);
    if (existing) {
      return res.status(409).json({ success: false, message: "Key already exists" });
    }
    const entry = service.addEntry(key, value || "");
    res.status(201).json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function update(req, res) {
  try {
    const { key } = req.params;
    const { value } = req.body;
    const entry = service.updateEntry(key, value);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Key not found" });
    }
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function toggle(req, res) {
  try {
    const { key } = req.params;
    const entry = service.toggleEntry(key);
    if (!entry) {
      return res.status(404).json({ success: false, message: "Key not found" });
    }
    res.json({ success: true, entry });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

async function remove(req, res) {
  try {
    const { key } = req.params;
    const deleted = service.deleteEntry(key);
    if (!deleted) {
      return res.status(404).json({ success: false, message: "Key not found" });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

module.exports = { list, create, update, toggle, remove };
