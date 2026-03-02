const bcrypt = require("bcrypt");

const comparePasswords = (passwordFromClient, encryptedPassword) => {
  return bcrypt.compareSync(passwordFromClient, encryptedPassword);
};

module.exports = { comparePasswords };
