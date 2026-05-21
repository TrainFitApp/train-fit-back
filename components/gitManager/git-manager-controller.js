const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "../..");
const TOKEN_PATH = path.resolve(BACKEND_ROOT, "../githubtoken");

function readTokenFile() {
  try {
    if (!fs.existsSync(TOKEN_PATH)) return "";
    return fs.readFileSync(TOKEN_PATH, "utf8").trim();
  } catch {
    return "";
  }
}

function writeTokenFile(token) {
  fs.writeFileSync(TOKEN_PATH, token, "utf8");
}

function getToken(req, res) {
  const token = readTokenFile();
  res.json({ success: true, token });
}

function saveToken(req, res) {
  const { token } = req.body;
  if (token === undefined) {
    return res.status(400).json({ success: false, message: "Token required" });
  }
  writeTokenFile(token);
  res.json({ success: true });
}

async function pull(req, res) {
  const token = readTokenFile();
  if (!token) {
    return res.status(400).json({ success: false, message: "No hay token guardado" });
  }

  let sent = false;

  exec("git remote get-url origin", { cwd: BACKEND_ROOT }, (errOrigin, stdoutOrigin) => {
    if (sent) return;
    if (errOrigin || !stdoutOrigin.trim()) {
      sent = true;
      return res.status(500).json({ success: false, message: "No se pudo obtener remote origin", stderr: errOrigin?.message });
    }

    let remoteUrl = stdoutOrigin.trim();

    if (remoteUrl.startsWith("https://")) {
      remoteUrl = remoteUrl.replace("https://", `https://TrainFit:${token}@`);
    }

    exec(`sudo git pull "${remoteUrl}" && sudo npm install`, { cwd: BACKEND_ROOT }, (errPull, stdout, stderr) => {
      if (sent) return;
      sent = true;
      if (errPull) {
        return res.json({ success: false, stdout: stdout || "", stderr: stderr || "Error ejecutando pull o npm install" });
      }
      res.json({ success: true, stdout: stdout || "", stderr: stderr || "" });
    });
  });
}

module.exports = { getToken, saveToken, pull };
