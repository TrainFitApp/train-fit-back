const createError = require("http-errors");
const { auth, basicAuth } = require("./validateAuth");

module.exports.validateAuth = auth(["user", "admin"]);
module.exports.auth = auth;
module.exports.basicAuth = basicAuth;

module.exports.error404Handler = (req, res, next) => {
  next(createError(404));
};

// eslint-disable-next-line
module.exports.errorHandler = (err, req, res, _next) => {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "dev" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.send({ message: err.message });
};
