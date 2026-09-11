const mongoose = require("mongoose");
const { buildMongoUri } = require("./_mongo-uri");
async function main() {
  await mongoose.connect(buildMongoUri());
  const User = require("../components/users/schema");
  const client = await User.findOne({ email: "nerea.mock@demo.trainfit.local" }).lean();
  console.log("Client:", client?._id?.toString(), client?.email);
  const TrainerClient = mongoose.models.TrainerClient || mongoose.model("TrainerClient", new mongoose.Schema({}, {strict:false}), "trainerclients");
  const rel = await TrainerClient.find({ clientId: client._id }).lean();
  console.log("Relations:", JSON.stringify(rel, null, 2));
  const CheckinRequest = mongoose.models.CheckinRequest || mongoose.model("CheckinRequest", new mongoose.Schema({}, {strict:false}), "checkinrequests");
  const count = await CheckinRequest.countDocuments({ clientId: client._id });
  console.log("CheckinRequest count for client:", count);
  await mongoose.disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
