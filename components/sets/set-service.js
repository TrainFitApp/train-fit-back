const setDao = require("./set-dao");

// Una serie siempre nace dentro de su ejercicio (al crearlo o al copiarlo):
// aquí solo se edita o se quita una que ya existe.
module.exports = {
  async updateSet(set) {
    return setDao.updateSet(set);
  },

  async deleteSet(id) {
    return setDao.deleteSet(id);
  },
};
