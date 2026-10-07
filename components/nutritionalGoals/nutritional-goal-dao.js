const mongoose = require("mongoose");
const User = require("../users/user-schema");
const { GOAL_FIELDS } = require("./nutritional-goal-schema");

// Objetivos nutricionales embebidos en el usuario (User.nutritionalGoals[]).
// Cada objetivo se devuelve con el `userId` de su dueño (no se guarda: es
// el documento que lo contiene).

const isId = (id) => mongoose.isValidObjectId(id) && /^[0-9a-fA-F]{24}$/.test(String(id));
const withOwner = (user, goal) => (goal ? { ...goal, userId: user._id } : null);
const newestFirst = (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0);

function setOf(data) {
  const $set = { "nutritionalGoals.$.updatedAt": new Date() };
  for (const field of GOAL_FIELDS) {
    if (data?.[field] !== undefined) $set[`nutritionalGoals.$.${field}`] = data[field];
  }
  return $set;
}

async function goalsOf(userId) {
  if (!isId(userId)) return [];
  const user = await User.findById(userId).select("nutritionalGoals").lean();
  return (user?.nutritionalGoals || []).map((goal) => withOwner(user, goal)).sort(newestFirst);
}

// Mongo no deja combinar la proyección posicional con devolver el documento
// ya actualizado: se escribe y se relee.
async function updateWhere(filter, id, data) {
  const result = await User.updateOne(filter, { $set: setOf(data) }, { runValidators: true });
  return result.matchedCount ? module.exports.findById(id) : null;
}

async function pullWhere(filter) {
  const user = await User.findOne(filter).select({ "nutritionalGoals.$": 1 }).lean();
  const goal = user?.nutritionalGoals?.[0];
  if (!goal) return null;
  await User.updateOne({ _id: user._id }, { $pull: { nutritionalGoals: { _id: goal._id } } });
  return withOwner(user, goal);
}

module.exports = {
  async create({ userId, ...data }) {
    const _id = new mongoose.Types.ObjectId();
    const goal = { _id };
    for (const field of GOAL_FIELDS) if (data[field] !== undefined) goal[field] = data[field];
    await User.updateOne({ _id: userId }, { $push: { nutritionalGoals: goal } }, { runValidators: true });
    return this.findById(_id);
  },

  async findById(id) {
    if (!isId(id)) return null;
    const user = await User.findOne({ "nutritionalGoals._id": id }).select({ "nutritionalGoals.$": 1 }).lean();
    return withOwner(user, user?.nutritionalGoals?.[0]);
  },

  async findByUserId(userId) {
    return goalsOf(userId);
  },

  async findLatestByUserId(userId) {
    return (await goalsOf(userId))[0] || null;
  },

  async countByUserId(userId) {
    return (await goalsOf(userId)).length;
  },

  async update(id, data) {
    if (!isId(id)) return null;
    return updateWhere({ "nutritionalGoals._id": id }, id, data);
  },

  async updateByUserId(id, userId, data) {
    if (!isId(id) || !isId(userId)) return null;
    return updateWhere({ _id: userId, "nutritionalGoals._id": id }, id, data);
  },

  async delete(id) {
    if (!isId(id)) return null;
    return pullWhere({ "nutritionalGoals._id": id });
  },

  async deleteByIdAndUserId(id, userId) {
    if (!isId(id) || !isId(userId)) return null;
    return pullWhere({ _id: userId, "nutritionalGoals._id": id });
  },

  // --- El objetivo en uso (User.goalInUse) ---
  async goalInUseId(userId) {
    if (!isId(userId)) return null;
    return (await User.findById(userId).select("goalInUse").lean())?.goalInUse || null;
  },

  async setGoalInUse(userId, goalId) {
    await User.updateOne({ _id: userId }, { $set: { goalInUse: goalId } });
  },

  async clearGoalInUse(userId) {
    await User.updateOne({ _id: userId }, { $unset: { goalInUse: "" } });
  },
};
