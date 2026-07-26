const { exec } = require("child_process");

const PM2_APP_NAME = "train-fit-back";

async function restart(req, res) {
  exec(`pm2 restart ${PM2_APP_NAME}`, (error, stdout, stderr) => {
    if (error) {
      console.error(`[server-manager] Restart error: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: `Error al reiniciar: ${error.message}`,
      });
    }
    console.log(`[server-manager] ${stdout}`);
    res.json({ success: true, message: "Servidor reiniciado correctamente" });
  });
}

module.exports = { restart };
