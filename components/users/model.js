const userDao = require("./dao");
const userDto = require("./dto");
const dietUtil = require("../diets/diet-util");
const dietModel = require("../diets/diet-model");
const dietDayModel = require("../dietDays/diet-days-service");
const dietDayUtil = require("../dietDays/diet-days-util");
const mail = require("../util/mail");
const userSchema = require("./schema");
const nutritionalGoalService = require("../nutritionalGoals/nutritional-goal-service");
const suggestionsEmailUser = process.env.SUGGESTIONS_MAIL_SENDER_USER;
const restorePassEmail = process.env.REGISTER_MAIL_SENDER_USER;
const jwt = require("jsonwebtoken");
const { generateVerificationCode } = require("../util/verification-code");

const HASH_CODE_TTL_MS = 15 * 60 * 1000;
const axios = require("axios");
const jwkToPem = require("jwk-to-pem");

const GOOGLE_ALLOWED_CLIENT_IDS = (
  process.env.GOOGLE_ALLOWED_CLIENT_IDS ||
  [
    "775987417074-s1e767h7tps05ectmrb85uqh7hhp9p8n.apps.googleusercontent.com",
    "775987417074-ibu27rm1ku8uuunaacebmp14ahvuuk4u.apps.googleusercontent.com",
  ].join(",")
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

  async searchUsers(page, limit, search, filters) {
    return userDao.searchUsers(page, limit, search, filters);
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

  async updateVerificationHash(userId, hash, expiresAt) {
    return await userDao.updateVerificationHash(userId, hash, expiresAt);
  },

  async resendVerificationCode(email) {
    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + HASH_CODE_TTL_MS);

    return userDao.resendVerificationHash(email, code, expiresAt);
  },

  async verifyActivationCode(email, code) {
    return await userDao.verifyActivationHash(email, code);
  },

  async updateGoogleUser(user, date) {
    const standardDietDay = dietDayUtil.getStandardDietDay(date);
    const dietDay = await dietDayModel.createDietDay(standardDietDay);

    const diet = dietUtil.getStandarDiet();
    diet.dietsDay.push(dietDay._id);
    const createdDiet = await dietModel.createDiet(diet);

    user.dietInUse = createdDiet._id;
    user.theme = "dark";

    user.tables = [];
    user.archivedProducts = [];
    user.archivedRecipes = [];
    user.archivedExercises = [];

    const updatedUser = await userDao.updateGoogleUser(user);

    if (updatedUser && (user.kcalTotal || user.proteinsGTotal || user.carbohydratesGTotal || user.fatGTotal)) {
      const goal = await nutritionalGoalService.create({
        userId: updatedUser._id,
        name: 'Default',
        kcalTotal: user.kcalTotal || 0,
        proteinsGTotal: user.proteinsGTotal || 0,
        carbohydratesGTotal: user.carbohydratesGTotal || 0,
        fatGTotal: user.fatGTotal || 0,
      });
      await userSchema.findByIdAndUpdate(updatedUser._id, { $set: { goalInUse: goal._id } });
      updatedUser.goalInUse = goal._id;
    }

    return updatedUser;
  },

  async updateAppleUser(user, date) {
    const standardDietDay = dietDayUtil.getStandardDietDay(date);
    const dietDay = await dietDayModel.createDietDay(standardDietDay);

    const diet = dietUtil.getStandarDiet();
    diet.dietsDay.push(dietDay._id);
    const createdDiet = await dietModel.createDiet(diet);

    user.dietInUse = createdDiet._id;
    user.theme = "dark";

    user.tables = [];
    user.archivedProducts = [];
    user.archivedRecipes = [];
    user.archivedExercises = [];

    const updatedUser = await userDao.updateAppleUser(user);

    if (updatedUser && (user.kcalTotal || user.proteinsGTotal || user.carbohydratesGTotal || user.fatGTotal)) {
      const goal = await nutritionalGoalService.create({
        userId: updatedUser._id,
        name: 'Default',
        kcalTotal: user.kcalTotal || 0,
        proteinsGTotal: user.proteinsGTotal || 0,
        carbohydratesGTotal: user.carbohydratesGTotal || 0,
        fatGTotal: user.fatGTotal || 0,
      });
      await userSchema.findByIdAndUpdate(updatedUser._id, { $set: { goalInUse: goal._id } });
      updatedUser.goalInUse = goal._id;
    }

    return updatedUser;
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

  async updatePassword(email, password) {
    return userDao.updatePassword(email, password);
  },

  async sendMailCode(email) {
    const code = Math.random().toString(36).substring(2, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    return userDao.sendMailCode(email, code, expiresAt);
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

  async clearUserHash(id) {
    return userDao.clearUserHash(id);
  },

  async validateGoogleToken(token) {
    try {
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

      const payload = jwt.verify(token, publicKey, {
        algorithms: ["RS256"],
        audience: GOOGLE_ALLOWED_CLIENT_IDS,
        issuer: ["https://accounts.google.com", "accounts.google.com"],
      });

      if (!payload?.email) {
        throw new Error("El token de Google no contiene email");
      }

      if (!payload?.email_verified) {
        throw new Error("El email de Google no está verificado");
      }

      return payload;
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

      const audiences = (
        process.env.APPLE_ALLOWED_AUDIENCES ||
        [process.env.APPLE_BUNDLE_ID, process.env.APPLE_SERVICE_ID]
          .filter(Boolean)
          .join(",")
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

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
