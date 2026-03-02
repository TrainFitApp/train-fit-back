const userDao = require("./dao");
const userDto = require("./dto");
const dietUtil = require("../diets/diet-util");
const dietModel = require("../diets/diet-model");
const dietDayModel = require("../dietDays/diet-days-service");
const dietDayUtil = require("../dietDays/diet-days-util");
const mail = require("../util/mail");
const suggestionsEmailUser = process.env.SUGGESTIONS_MAIL_SENDER_USER;
const restorePassEmail = process.env.REGISTER_MAIL_SENDER_USER;
const jwt = require("jsonwebtoken");
const axios = require("axios");
const jwkToPem = require("jwk-to-pem");

module.exports = {
  async getUserById(id) {
    return userDao.getUserById(id);
  },

  async countUsers() {
    return userDao.countUsers();
  },

  async getUserByEmail(email) {
    return await userDao.findByEmail(email);
  },

  async getUserByAppleId(appleId) {
    return await userDao.findByAppleId(appleId);
  },

  async checkEmailExists(email) {
    return await userDao.existsByEmail(email);
  },

  async searchUsers(user, date, search) {
    return userDao.searchUsers(user, date, search);
  },

  async createUser(user, date) {
    return userDao.createUser(user, date);
  },

  async searchArchivedsByFilter(node, archivedNode, search) {
    return userDao.searchArchivedsByFilter(node, archivedNode, search);
  },

  async addUserDiet(idUser, idDiet) {
    return userDao.addUserDiet(idUser, idDiet);
  },

  async addUserTable(idUser, idTable) {
    return userDao.addUserTable(idUser, idTable);
  },

  async updateUser(user) {
    return await userDao.updateUser(user);
  },

  async updateGoogleUser(user, date) {
    const standardDietDay = dietDayUtil.getStandardDietDay(date);
    const dietDay = await dietDayModel.createDietDay(standardDietDay);

    const diet = dietUtil.getStandarDiet();
    diet.dietsDay.push(dietDay._id);
    const createdDiet = await dietModel.createDiet(diet);

    user.dietInUse = createdDiet._id;
    user.theme = "dark";

    user.ownTables = [];
    user.archivedDiets = [];
    user.archivedDietDays = [];
    user.archivedMeals = [];
    user.archivedProducts = [];
    user.archivedRecipes = [];
    user.archivedTables = [];
    user.archivedSplits = [];
    user.archivedWorkouts = [];
    user.archivedExercises = [];

    return await userDao.updateGoogleUser(user);
  },

  async updateAppleUser(user, date) {
    const standardDietDay = dietDayUtil.getStandardDietDay(date);
    const dietDay = await dietDayModel.createDietDay(standardDietDay);

    const diet = dietUtil.getStandarDiet();
    diet.dietsDay.push(dietDay._id);
    const createdDiet = await dietModel.createDiet(diet);

    user.dietInUse = createdDiet._id;
    user.theme = "dark";

    user.ownTables = [];
    user.archivedDiets = [];
    user.archivedDietDays = [];
    user.archivedMeals = [];
    user.archivedProducts = [];
    user.archivedRecipes = [];
    user.archivedTables = [];
    user.archivedSplits = [];
    user.archivedWorkouts = [];
    user.archivedExercises = [];

    return await userDao.updateAppleUser(user);
  },

  async createUserApple(user, date) {
    return await userDao.createUserWithApple(user, date);
  },

  async playStopDiet(id, playStopDiet) {
    return userDao.playStopDiet(id, playStopDiet);
  },

  async addFavouriteProduct(idUser, idProduct, productExist) {
    return userDao.addFavoriteProduct(idUser, idProduct, productExist);
  },

  async addFavouriteRecipe(idUser, idRecipe, isOwn, recipeExist) {
    return userDao.addFavoriteRecipe(idUser, idRecipe, isOwn, recipeExist);
  },

  async restorePassword(email, newPassword) {
    return userDao.restorePassword(email, newPassword);
  },

  async updatePassword(email, password) {
    return userDao.updatePassword(email, password);
  },

  async sendMailCode(email) {
    const hashTemp = Math.floor(100000 + Math.random() * 900000).toString();

    return userDao.sendMailCode(email, hashTemp);
  },

  async checkRestoreCode(email, password, hash) {
    return await userDao.checkRestoreCode(email, password, hash);
  },

  async sendSuggestions(email, suggestions) {
    return mail.sendMail(
      suggestionsEmailUser,
      suggestionsEmailUser,
      "Sugerencia de: " + email,
      suggestions,
    );
  },

  async deleteUser(id) {
    return userDao.deleteUser(id);
  },

  async checkHash(id, hash) {
    return userDao.checkHash(id, hash);
  },

  async validateGoogleToken(token) {
    try {
      // Decodificar el header del token sin verificar
      const decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader) throw new Error("Token inválido");

      const kid = decodedHeader.header.kid;

      // Obtener claves públicas de Google
      const url = "https://www.googleapis.com/oauth2/v3/certs";
      const response = await axios.get(url);
      const claves = response.data.keys;

      // Buscar la clave pública correcta
      const key = claves.find((k) => k.kid === kid);
      if (!key) throw new Error("No se encontró la clave pública adecuada");

      // Convertir la clave pública de JWK a PEM
      const publicKey = jwkToPem(key);

      // Verificar y decodificar el token
      const payload = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
      });

      return payload; // Contiene los datos del usuario
    } catch (error) {
      throw new Error(`Error en la validación: ${error.message}`);
    }
  },

  async validateAppleToken(token) {
    try {
      const decodedHeader = jwt.decode(token, { complete: true });
      if (!decodedHeader) throw new Error("Token de Apple inválido");

      const kid = decodedHeader.header.kid;

      const url = "https://appleid.apple.com/auth/keys";
      const response = await axios.get(url);
      const claves = response.data.keys;

      const key = claves.find((k) => k.kid === kid);
      if (!key)
        throw new Error("No se encontró la clave pública de Apple adecuada");

      const publicKey = jwkToPem(key);

      const audiences = [
        process.env.APPLE_BUNDLE_ID,
        process.env.APPLE_SERVICE_ID,
      ].filter(Boolean);

      const verifyOptions = {
        algorithms: ["RS256"],
        issuer: "https://appleid.apple.com",
      };

      if (audiences.length === 1) {
        verifyOptions.audience = audiences[0];
      } else if (audiences.length > 1) {
        verifyOptions.audience = audiences;
      }

      const payload = jwt.verify(token, publicKey, verifyOptions);

      return payload;
    } catch (error) {
      throw new Error(`Error en la validación de Apple: ${error.message}`);
    }
  },
};
