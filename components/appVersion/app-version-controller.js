const packageJson = require("../../package.json");

function getAppVersion(req, res) {
  res.json({
    version: packageJson.version,
  });
}

module.exports = {
  getAppVersion,
};
