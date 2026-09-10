const express = require("@awaitjs/express");
const { auth } = require("../../middleware/validateAuth");
const { getTimeZone, setTimeZone } = require("./measurement-profile");
const { civilToday, validTimeZone } = require("./body-metrics");
const router = express.Router();

router.getAsync("/me/measurement-profile", auth(["user"]), async (req, res) => {
  const timeZone = await getTimeZone(req.auth.userId);
  res.send({ timeZone, today: civilToday(timeZone) });
});
router.putAsync("/me/measurement-profile", auth(["user"]), async (req, res) => {
  if (!validTimeZone(req.body?.timeZone)) return res.status(400).send({ message: "La zona horaria no es válida" });
  const timeZone = await setTimeZone(req.auth.userId, req.body.timeZone);
  res.send({ timeZone, today: civilToday(timeZone) });
});
module.exports = router;
