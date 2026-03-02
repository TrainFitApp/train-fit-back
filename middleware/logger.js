const fs = require("fs");
const path = require("path");
const morgan = require("morgan");

// const skipSuccess = (req, res) => res.statusCode < 400;
const logStream = fs.createWriteStream(path.join(__dirname, '../file.log'), { flags: 'a' })

// Custom morgan format que incluye el email del usuario del JWT al inicio si existe
const morganFormat = ':user-email :remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"';

morgan.token('user-email', (req) => {
  return req.userData?.email ? `[${req.userData.email}]` : '';
});

const logger = morgan(morganFormat, { stream: logStream })

module.exports = (req, res, next) => {
    logger(req, res, function (err) {
      return next();
    })
  };
