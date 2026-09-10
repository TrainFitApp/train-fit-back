const mongoose = require("mongoose");

// Las colecciones nuevas participan en el borrado de cuenta existente.
async function deleteForUser(userId) {
  const id = new mongoose.Types.ObjectId(userId);
  const pair = { $or: [{ trainerId: id }, { clientId: id }] };
  for (const name of ["coachingstages", "clientoverviewreviews", "clientoverviewaudits", "coachtasks"]) {
    await mongoose.connection.collection(name).deleteMany(pair);
  }
  await mongoose.connection.collection("measurementcorrections").deleteMany({ $or: [{ clientId: id }, { actorId: id }] });
  await mongoose.connection.collection("clientmeasurementprofiles").deleteMany({ clientId: id });
}
module.exports = { deleteForUser };
