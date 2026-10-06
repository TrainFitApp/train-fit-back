const mongoose = require("mongoose");

// Favoritos del usuario (User.favorites): productos, recetas y ejercicios que
// ha marcado. Es la única puerta a esos arrays: la búsqueda de alimentos y de
// ejercicios los lee por aquí, y las cascadas de borrado los limpian por aquí.
// El modelo se pide al usar (no al cargar): los hooks de borrado de
// productos, recetas y ejercicios llaman aquí y no deben cargar User.

const KINDS = ["products", "recipes", "exercises"];
const User = () => mongoose.model("User");
const path = (kind) => `favorites.${kind}`;

module.exports = {
  KINDS,

  async list(userId, kind) {
    const user = await User().findById(userId).select(path(kind)).lean();
    return user?.favorites?.[kind] || [];
  },

  async includes(userId, kind, id) {
    return Boolean(await User().exists({ _id: userId, [path(kind)]: id }));
  },

  async add(userId, kind, id) {
    await User().updateOne({ _id: userId }, { $addToSet: { [path(kind)]: id } });
  },

  async remove(userId, kind, id) {
    await User().updateOne({ _id: userId }, { $pull: { [path(kind)]: id } });
  },

  // Lo que deja de existir sale de los favoritos de todos.
  async removeEverywhere(kind, ids) {
    const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
    if (!list.length) return;
    await User().updateMany({ [path(kind)]: { $in: list } }, { $pull: { [path(kind)]: { $in: list } } });
  },
};
