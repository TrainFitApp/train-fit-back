const { promisify } = require("util");
const { exec } = require("child_process");
const service = require("./env-manager-service");
const { badRequest, conflict, notFound } = require("../util/http-error");

const KEY_FORMAT = /^[A-Z_][A-Z0-9_]*$/;
const keyNotFound = () => notFound("Key not found");

async function list(req, res) {
  res.json({ success: true, entries: service.getEntries() });
}

async function create(req, res) {
  const { key, value } = req.body;
  if (!key || !KEY_FORMAT.test(key)) throw badRequest("Invalid key format");
  if (service.getEntries().some((entry) => entry.key === key)) throw conflict("Key already exists");
  res.status(201).json({ success: true, entry: service.addEntry(key, value || "") });
}

async function update(req, res) {
  const entry = service.updateEntry(req.params.key, req.body.value);
  if (!entry) throw keyNotFound();
  res.json({ success: true, entry });
}

async function toggle(req, res) {
  const entry = service.toggleEntry(req.params.key);
  if (!entry) throw keyNotFound();
  res.json({ success: true, entry });
}

async function remove(req, res) {
  if (!service.deleteEntry(req.params.key)) throw keyNotFound();
  res.json({ success: true });
}

async function listDbProfiles(req, res) {
  res.json({ success: true, profiles: service.getDbProfiles() });
}

// Cambia la base de datos del .env y reinicia el proceso (PM2).
async function switchDb(req, res) {
  const { name } = req.body;
  if (!name) throw badRequest("Profile name required");
  const result = service.switchDbProfile(name);
  if (!result.success) throw badRequest(result.message || "No se pudo cambiar de base de datos");
  await promisify(exec)("pm2 restart train-fit-back");
  res.json({ success: true, message: `Switched to "${name}". Servidor reiniciado.` });
}

module.exports = { list, create, update, toggle, remove, listDbProfiles, switchDb };
