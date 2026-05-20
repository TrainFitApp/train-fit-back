const { exec } = require("child_process");
const path = require("path");

const BACKEND_ROOT = path.resolve(__dirname, "../..");

async function restart(req, res) {
  const ecosystemFile = path.join(BACKEND_ROOT, "ecosystem.config.js");
  const command = `sudo pm2 kill && sudo systemctl restart nginx && pm2 start ${ecosystemFile}`;

  exec(command, { cwd: BACKEND_ROOT }, (error, stdout, stderr) => {
    if (error) {
      console.error(`[server-manager] Restart error: ${error.message}`);
      if (stderr) console.error(`[server-manager] stderr: ${stderr}`);
      return;
    }
    if (stdout) console.log(`[server-manager] stdout: ${stdout}`);
    if (stderr) console.log(`[server-manager] stderr: ${stderr}`);
  });

  res.json({ success: true, message: "Comando de reinicio ejecutado" });
}

module.exports = { restart };
