const reviewQueueService = require("./review-queue-service");
const { baseUrlOf } = require("../media/media-controller");

module.exports = {
  // GET /trainer/review-queue
  async list(req, res) {
    return res.send(await reviewQueueService.list(req.auth.userId, { baseUrl: baseUrlOf(req) }));
  },

  // GET /trainer/review-queue/count
  async count(req, res) {
    return res.send(await reviewQueueService.count(req.auth.userId));
  },
};
