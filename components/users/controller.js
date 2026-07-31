const userModel = require("./model");
const userDto = require("./dto");
const userSchema = require("../users/schema");
const bcrypt = require("../util/bcrypt");
const mail = require("./../util/mail");
const jwt = require("jsonwebtoken");

const PASSWORD_RESET_REQUEST_RESPONSE = {
  message:
    "Si existe una cuenta con ese correo, enviaremos un codigo de verificacion.",
};
const PASSWORD_RESET_INVALID_CODE_RESPONSE = {
  message: "Codigo invalido o expirado",
};

async function generateAndSetTokens(user, res) {
  throw new Error("Auth endpoint moved to /api/auth");
}

const htmlFinalResponse1 = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="es">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Cuenta Activada</title>
    <div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0"></div>
  </head>
  <body style='background-color:rgb(243,244,246);font-family:ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";padding-top:40px;padding-bottom:40px'>
    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:rgb(255,255,255);border-radius:8px;margin-left:auto;margin-right:auto;padding:20px;max-width:600px">
      <tbody>
        <tr style="width:100%">
          <td>
            <h1 style="font-size:24px;font-weight:700;text-align:center;margin-top:30px;margin-bottom:30px;margin-left:0px;margin-right:0px;color:#FE9000">
              {{HEADER_MESSAGE}}
            </h1>`;

const htmlFinalContent1 = `
            <p style="font-size:16px;line-height:24px;color:rgb(55,65,81);margin-bottom:16px;margin-top:16px">
              ¡Gracias por registrarte! Tu cuenta ha sido activada correctamente.
            </p>
            <p style="font-size:16px;line-height:24px;color:rgb(55,65,81);margin-bottom:24px;margin-top:16px">
              Ya puedes dirigirte a la app e iniciar sesión para comenzar a disfrutar de todos nuestros servicios.
            </p>
            <h1 style="font-size:24px;font-weight:700;text-align:center;margin-top:30px;margin-bottom:30px;margin-left:0px;margin-right:0px;color:#FE9000">
              ¡Bienvenido a TrainFit!
            </h1>
          
`;

const htmlFinalContent2 = `
            <p style="font-size:16px;line-height:24px;color:rgb(55,65,81);margin-bottom:16px;margin-top:16px">
              El enlace de activación no es válido o ha expirado.
            </p>
            <p style="font-size:16px;line-height:24px;color:rgb(55,65,81);margin-bottom:24px;margin-top:16px">
              Solicita un nuevo enlace desde la app o ponte en contacto con soporte si el problema persiste.
            </p>
`;

const htmlFinalResponse2 = `
            <hr style="border-top-width:1px;border-color:rgb(209,213,219);margin-top:24px;margin-bottom:24px;width:100%;border:none;border-top:1px solid #eaeaea" />
            <p style="font-size:12px;line-height:16px;color:rgb(107,114,128);margin-bottom:4px;margin-top:16px">
              Si tienes alguna pregunta, por favor contacta con nuestro equipo de soporte en suggestions@trainfit.net
            </p>
            <p style="font-size:12px;line-height:16px;color:rgb(107,114,128);margin:0">
              © ${new Date().getFullYear()} TrainFit. Todos los derechos reservados.
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;

function isAdmin(req) {
  return Boolean(req.userData?.roles?.includes("admin"));
}

function canActOnUser(req, targetUserId) {
  return isAdmin(req) || String(req.user?.id) === String(targetUserId);
}

function notifyUserRegistered(user, req, source, provider) {
  mail.notifyUserRegistered(user, {
    source,
    provider: provider || user?.provider || "email",
    ip: req.ip,
    userAgent: req.headers?.["user-agent"],
  });
}

async function clearUserAuth(userId) {
  if (!userId) return null;
  return userSchema.findByIdAndUpdate(userId, { $unset: { auth: 1 } });
}

module.exports = {
  async countUsers(req, res) {
    const count = await userModel.countUsers();
    return res.send(count);
  },

  async checkEmail(req, res) {
    try {
      const email = req.params?.email;
      if (!email) {
        return res.status(400).send({ message: "Email requerido" });
      }
      const user = await userModel.getUserByEmail(email);
      // Si el usuario existe pero no tiene nombre (registro social incompleto), permitimos el email
      if (user && !user.name) {
        return res.send({ emailExist: false });
      }
      return res.send({ emailExist: !!user });
    } catch (err) {
      console.error("Error al comprobar email:", err);
      return res.status(500).send({ message: "No se pudo comprobar el email" });
    }
  },

  async getUserByEmail(req, res) {
    const user = await userDto.single(
      await userModel.getUserByEmail(req.params.email),
    );
    return res.send(user);
  },

  async searchUsers(req, res) {
    const page = req.body.page;
    const limit = 10;
    const search = req.body.search;
    const filters = req.body.filters || {};

    const result = await userModel.searchUsers(page, limit, search, filters);
    return res.send(result);
  },

  async createUser(req, res) {
    try {
      const email = req.body?.user?.email;
      if (!email) {
        return res.status(400).send({ message: "Email requerido" });
      }

      // Validar que el email existe (DNS/MX) ANTES de crear usuario
      const emailExists = await mail.validateEmailExists(email);
      if (!emailExists) {
        return res.status(400).send({
          message: "El correo no existe",
        });
      }

      const userExist = await userModel.getUserByEmail(email);
      if (userExist && userExist.name) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }

      const hashTemp = Math.floor(100000 + Math.random() * 900000).toString();

      const user = await userModel.createUser(
        {
          name: req.body.user.name,
          lastname: req.body.user.lastname,
          password: req.body.user.password,
          activity: req.body.user.activity,
          steps: req.body.user.steps,
          sex: req.body.user.sex,
          height: req.body.user.height,
          weight: req.body.user.weight,
          training: req.body.user.training,
          objetive: req.body.user.objetive,
          birth: req.body.user.birth,
          kcalTotal: req.body.user.kcalTotal,
          proteinsGTotal: req.body.user.proteinsGTotal,
          carbohydratesGTotal: req.body.user.carbohydratesGTotal,
          fatGTotal: req.body.user.fatGTotal,
          email: email,
          roles: ["user"],
          hash: hashTemp,
        },
        req.body.date,
      );

      notifyUserRegistered(user, req, "users.createUser", "email");

      // ---- Cabeceras y textos del NUEVO correo de activación ----
      const header1 = `Hola ${req.body.user.name}, verifique su cuenta`;
      const description =
        "Introduce el siguiente código en la aplicación para finalizar el registro.";

      // Generar HTML con el nuevo template de hash
      const htmlMail = mail.generateHashMail(header1, description, hashTemp);

      await mail.sendMailSES(
        user.email,
        "Verificación de cuenta - TrainFit",
        htmlMail,
      );

      return res.send(await userDto.single(user, req.user));
    } catch (err) {
      // Manejo de clave duplicada (race condition) y errores genéricos
      const isDup =
        err?.code === 11000 ||
        (typeof err?.message === "string" &&
          err.message.toLowerCase().includes("duplicate key"));
      if (isDup) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }
      console.error("Error al crear usuario:", err);
      return res.status(500).send({ message: "No se pudo crear el usuario" });
    }
  },

  /**
   * Registro de profesional (TrainFit: Entrenadores) — F01. A propósito NO
   * reutiliza userModel.createUser/userDao.createUser: esa función crea
   * automáticamente una Diet/DietDay por defecto (comportamiento correcto para
   * un cliente consumidor, pero incorrecto aquí — un profesional no es
   * necesariamente cliente de TrainFit). Sigue el mismo patrón limpio que ya
   * usa el registro social (userSchema.create directo, sin efectos
   * secundarios de dominio de consumidor).
   *
   * POST /api/users/professional
   * Body: { name, lastname, email, password }
   */
  async createProfessionalUser(req, res) {
    try {
      const { name, lastname, email: emailRaw, password } = req.body || {};
      const email = String(emailRaw || "").trim().toLowerCase();

      if (!name || !lastname || !email || !password) {
        return res.status(400).send({ message: "Nombre, apellidos, email y contraseña son obligatorios" });
      }

      const emailExists = await mail.validateEmailExists(email);
      if (!emailExists) {
        return res.status(400).send({ message: "El correo no existe" });
      }

      const userExist = await userModel.getUserByEmail(email);
      if (userExist && userExist.name) {
        return res.status(409).send({ message: "Este usuario ya está registrado" });
      }

      const hashTemp = Math.floor(100000 + Math.random() * 900000).toString();

      const user = await userSchema.create({
        name,
        lastname,
        email,
        password,
        roles: ["trainer"],
        hash: hashTemp,
      });

      notifyUserRegistered(user, req, "users.createProfessionalUser", "email");

      const header1 = `Hola ${name}, verifica tu cuenta`;
      const description = "Introduce el siguiente código en la aplicación para finalizar el registro.";
      const htmlMail = mail.generateHashMail(header1, description, hashTemp);
      await mail.sendMailSES(user.email, "Verificación de cuenta - TrainFit Entrenadores", htmlMail);

      return res.status(201).send(await userDto.single(user, req.user));
    } catch (err) {
      const isDup =
        err?.code === 11000 ||
        (typeof err?.message === "string" && err.message.toLowerCase().includes("duplicate key"));
      if (isDup) {
        return res.status(409).send({ message: "Este usuario ya está registrado" });
      }
      console.error("Error al crear usuario profesional:", err);
      return res.status(500).send({ message: "No se pudo crear el usuario" });
    }
  },

  /**
   * Crea un usuario nuevo desde Google Sign-In
   * Solo se crea con email, los demás datos se completan después en updateGoogleUser
   *
   * POST /users/google
   * Body: { user: { email } }
   * Response: { user, access_token, token_type }
   */
  async createSocialUser(req, res) {
    try {
      let email = req.body?.user?.email?.toLowerCase();
      const provider = req.body?.provider; // 'google' or 'apple'
      let appleId = null;

      if (!provider || !["google", "apple"].includes(provider)) {
        return res
          .status(400)
          .send({ message: "Proveedor inválido o requerido" });
      }

      // Validación específica para Apple
      if (provider === "apple") {
        const { tokenApple } = req.body;
        if (!tokenApple) {
          return res.status(400).send({ message: "Token de Apple requerido" });
        }

        try {
          const payload = await userModel.validateAppleToken(tokenApple);
          appleId = payload?.sub;
          const tokenEmail = payload?.email?.toLowerCase();

          // Priorizar email del token si existe (es el verificado por Apple), sino usar el del body
          if (tokenEmail) {
            email = tokenEmail;
          }

          if (!email || !appleId) {
            return res.status(400).send({
              message: "Datos de usuario incompletos de Apple.",
              details: { hasAppleId: !!appleId, hasEmail: !!email },
            });
          }
        } catch (error) {
          console.error("Error validando token Apple en creación:", error);
          return res.status(401).send({ message: "Token de Apple inválido" });
        }
      }

      if (!email) {
        return res.status(400).send({ message: "Email requerido" });
      }

      // Verificar que no exista por email
      let userExist = await userModel.getUserByEmail(email);

      // Si es Apple, verificar también por appleId si no se encontró por email
      if (!userExist && appleId) {
        userExist = await userModel.getUserByAppleId(appleId);
      }

      if (userExist) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }

      // Preparar objeto de usuario
      const newUser = {
        email,
        roles: ["user"],
        provider: provider,
      };

      // Añadir appleId si corresponde
      if (provider === "apple" && appleId) {
        newUser.appleId = appleId;
      }

      // Crear usuario
      // Nota: insertMany es rápido, pero para Apple usábamos createUserWithApple en DAO.
      // Sin embargo, insertMany es suficiente si pasamos los campos correctos.
      let user = await userSchema.insertMany([newUser]);
      user = user[0];

      notifyUserRegistered(user, req, "users.createSocialUser", provider);

      // Generar tokens y configurar cookie
      const { accessToken } = await generateAndSetTokens(user, res);

      return res.status(201).send({
        user: user,
        access_token: accessToken,
        token_type: "bearer",
      });
    } catch (err) {
      const isDup =
        err?.code === 11000 ||
        (typeof err?.message === "string" &&
          err.message.toLowerCase().includes("duplicate key"));
      if (isDup) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }
      console.error(`Error al crear usuario con ${req.body?.provider}:`, err);
      return res.status(500).send({ message: "No se pudo crear el usuario" });
    }
  },

  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res
          .status(400)
          .send({ message: "Email y contraseña requeridos" });
      }

      const user = await userModel.getUserByEmail(email);

      if (!user) {
        return res.status(404).send({ message: "Este usuario no existe" });
      }

      if (user.hash) {
        // Generar nuevo codigo y enviar correo
        const hashTemp = Math.floor(100000 + Math.random() * 900000).toString();

        // Actualizar user hash en BD
        await userModel.updateVerificationHash(user._id, hashTemp);

        // Send mail
        const header1 = `Hola ${user.name}, verifique su cuenta`;
        const description =
          "Introduce el siguiente código en la aplicación para finalizar el registro.";
        const htmlMail = mail.generateHashMail(header1, description, hashTemp);
        await mail.sendMailSES(
          user.email,
          "Verificación de cuenta - TrainFit",
          htmlMail,
        );

        return res.status(403).send({
          error: "ACCOUNT_NOT_VERIFIED",
          message: "Cuenta no verificada. Se ha enviado un nuevo código.",
          email: user.email,
        });
      }

      const isMatch = bcrypt.comparePasswords(password, user.password);
      if (!isMatch) {
        return res.status(401).send({ message: "Contraseña incorrecta" });
      }

      // Generar tokens y configurar cookie
      const { accessToken } = await generateAndSetTokens(user, res);

      return res.status(200).send({
        access_token: accessToken,
        token_type: "bearer",
        theme: user.theme,
      });
    } catch (error) {
      console.error("Error in login:", error);
      return res.status(500).send({ message: "Error al iniciar sesión" });
    }
  },

  async refreshToken(req, res) {
    return res.status(410).send({
      message: "Auth endpoint moved to /api/auth",
      code: "AUTH_ENDPOINT_GONE",
    });
  },

  async logout(req, res) {
    return res.status(410).send({
      message: "Auth endpoint moved to /api/auth",
      code: "AUTH_ENDPOINT_GONE",
    });
  },

  /**
   * Verifica un usuario existente con Google Sign-In
   * Si el usuario existe, valida el token de Google y devuelve tokens JWT
   *
   * POST /users/auth/verify-google
   * Body: { email, tokenGoogle }
   * Response: { user, access_token, token_type }
   */
  async verifyGoogle(req, res) {
    const { tokenGoogle, email } = req.body;

    if (!tokenGoogle || !email) {
      return res.status(400).send({ message: "Token y email requeridos" });
    }

    // PASO 1: Buscar usuario existente PRIMERO (sin verificar token aún)
    // Si el usuario no existe → siempre 404 (independiente del token)
    let user;
    try {
      user = await userModel.getUserByEmail(email.toLowerCase());
    } catch (dbError) {
      console.error("Error al buscar usuario Google:", dbError);
      return res.status(500).send({ message: "Error al buscar usuario" });
    }

    if (!user) {
      // Usuario no existe en la BD → debe ir al formulario de registro
      return res.status(404).send({ message: "Usuario no encontrado" });
    }

    // PASO 2: Solo si el usuario existe, validar el token de Google
    try {
      await userModel.validateGoogleToken(tokenGoogle);
    } catch (tokenError) {
      console.error("Error validando token de Google:", tokenError);
      return res
        .status(401)
        .send({ message: "Token de Google inválido o expirado" });
    }

    // PASO 3: Generar tokens JWT y configurar cookie
    try {
      const { accessToken } = await generateAndSetTokens(user, res);
      return res.status(200).send({
        user: user,
        access_token: accessToken,
        token_type: "bearer",
      });
    } catch (error) {
      console.error("Error generando tokens Google:", error);
      return res.status(500).send({ message: "Error al generar tokens" });
    }
  },

  async verifyApple(req, res) {
    const { tokenApple, email } = req.body;

    if (!tokenApple) {
      return res.status(400).send({ message: "Token requerido" });
    }

    // PASO 1: Decodificar el token SIN verificar la firma para obtener appleId/email
    // Esto es seguro porque solo usamos los datos para buscar al usuario.
    // La validación criptográfica completa se hace en el Paso 3 si el usuario existe.
    let appleId = null;
    let tokenEmail = null;
    try {
      const decoded = jwt.decode(tokenApple, { complete: true });
      if (!decoded || !decoded.payload) {
        return res.status(400).send({ message: "Token de Apple malformado" });
      }
      appleId = decoded.payload?.sub;
      tokenEmail = decoded.payload?.email?.toLowerCase();
    } catch (decodeError) {
      console.error("Error decodificando token Apple:", decodeError);
      return res.status(400).send({ message: "Token de Apple inválido" });
    }

    const normalizedEmail = email?.toLowerCase() || tokenEmail;

    // PASO 2: Buscar el usuario PRIMERO (sin validar firm del token aún)
    // Si el usuario no existe → siempre 404 (para redirigir al registro)
    let user = null;
    try {
      if (appleId) {
        user = await userModel.getUserByAppleId(appleId);
      }
      if (!user && normalizedEmail) {
        user = await userModel.getUserByEmail(normalizedEmail);
      }
    } catch (dbError) {
      console.error("Error al buscar usuario Apple:", dbError);
      return res.status(500).send({ message: "Error al buscar usuario" });
    }

    if (!user) {
      // Usuario no existe en la BD → debe ir al formulario de registro
      return res.status(404).send({ message: "Usuario no encontrado" });
    }

    // PASO 3: Solo si el usuario existe, validar la firma completa del token
    try {
      await userModel.validateAppleToken(tokenApple);
    } catch (tokenError) {
      console.error("Error validando firma del token Apple:", tokenError);
      return res
        .status(401)
        .send({ message: "Token de Apple inválido o expirado" });
    }

    // PASO 4: Actualizar appleId si no lo tenía y generar tokens
    try {
      if (!user.appleId && appleId) {
        user = await userSchema.findByIdAndUpdate(
          user._id,
          { appleId: appleId },
          { new: true },
        );
      }

      const { accessToken } = await generateAndSetTokens(user, res);

      return res.status(200).send({
        user: user,
        access_token: accessToken,
        token_type: "bearer",
      });
    } catch (error) {
      console.error("Error generando tokens Apple:", error);
      return res.status(500).send({ message: "Error al generar tokens" });
    }
  },

  async createUserApple(req, res) {
    try {
      const { user: userToCreate, date, tokenApple } = req.body;
      console.log(
        "Creando usuario Apple. Email proporcionado:",
        userToCreate?.email,
      );

      if (!tokenApple) {
        return res.status(400).send({ message: "Token de Apple requerido" });
      }

      const payload = await userModel.validateAppleToken(tokenApple);
      const appleId = payload?.sub;
      const tokenEmail = payload?.email?.toLowerCase();
      const email = userToCreate?.email?.toLowerCase() || tokenEmail;

      console.log(
        "Payload Apple decodificado. appleId:",
        appleId,
        "tokenEmail:",
        tokenEmail,
      );

      if (!email || !appleId) {
        return res.status(400).send({
          message:
            "Datos de usuario incompletos de Apple. No se pudo obtener el email.",
          details: { hasAppleId: !!appleId, hasEmail: !!email },
        });
      }

      let existingUser = await userModel.getUserByAppleId(appleId);
      if (!existingUser) {
        existingUser = await userModel.getUserByEmail(email);
      }

      if (existingUser) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }

      const newUser = {
        ...(userToCreate || {}),
        email: email,
        appleId: appleId,
        roles: ["user"],
        provider: "apple",
      };

      // Crear usuario
      const user = await userModel.createUserApple(newUser, date);

      notifyUserRegistered(user, req, "users.createUserApple", "apple");

      // Generar tokens y configurar cookie
      const { accessToken } = await generateAndSetTokens(user, res);

      return res.status(201).send({
        user: user,
        access_token: accessToken,
        token_type: "bearer",
      });
    } catch (err) {
      const isDup =
        err?.code === 11000 ||
        (typeof err?.message === "string" &&
          err.message.toLowerCase().includes("duplicate key"));
      if (isDup) {
        return res
          .status(409)
          .send({ message: "Este usuario ya está registrado" });
      }
      console.error("Error al crear usuario con Apple:", err);
      return res.status(500).send({ message: "No se pudo crear el usuario" });
    }
  },

  async updateAppleUser(req, res) {
    try {
      const { user: userUpdate, date } = req.body;
      if (!userUpdate || !userUpdate.email) {
        return res.status(400).send({ message: "Email requerido" });
      }

      const userCurr = await userModel.getUserByEmail(userUpdate.email);
      if (userCurr && userCurr.name && userCurr.lastname) {
        return res
          .status(400)
          .send({ message: "Este perfil de Apple ya está completo" });
      }

      const user = await userModel.updateAppleUser(userUpdate, date);
      const { accessToken } = await generateAndSetTokens(user, res);

      return res.send({
        access_token: accessToken,
        token_type: "bearer",
        user: user,
      });
    } catch (err) {
      console.error("Error al actualizar usuario con Apple:", err);
      return res
        .status(500)
        .send({ message: "No se pudo actualizar el usuario" });
    }
  },

  async searchArchivedsByFilter(req, res) {
    const user = await userModel.searchArchivedsByFilter(
      req.body.node,
      req.body.nodeArchived,
      req.body.search,
    );

    return res.send(user);
  },

  async addUserDiet(req, res) {
    if (!canActOnUser(req, req.params.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const user = await userModel.addUserDiet(
      req.params.idUser,
      req.params.idDiet,
    );

    return res.send(user);
  },

  async addUserTable(req, res) {
    if (!canActOnUser(req, req.params.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const user = await userModel.addUserTable(
      req.params.idUser,
      req.params.idTable,
    );

    return res.send(user);
  },

  async updateUser(req, res) {
    if (!req.body?._id) {
      return res.status(400).send({ message: "ID de usuario requerido" });
    }
    if (!canActOnUser(req, req.body._id.toString())) {
      return res.status(403).send({ message: "No tienes permiso para actualizar este usuario" });
    }

    const user = await userModel.updateUser(req.body);
    return res.send(user);
  },

  async updateSocialUser(req, res) {
    const userCurr = await userModel.getUserByEmail(req.body.user.email);
    // Verificación más robusta: si tiene nombre y apellido, ya está registrado
    if (userCurr && userCurr.name && userCurr.lastname)
      return res
        .status(409) // Conflict es más apropiado que 500
        .send({ message: "El usuario ya ha completado su registro" });

    // Determinar método de actualización según proveedor
    let user;
    if (userCurr.provider === "apple") {
      user = await userModel.updateAppleUser(req.body.user, req.body.date);
    } else {
      user = await userModel.updateGoogleUser(req.body.user, req.body.date);
    }

    const { accessToken } = await generateAndSetTokens(user, res);

    return res.send({
      access_token: accessToken,
      token_type: "bearer",
      user: user,
    });
  },

  async playStopDiet(req, res) {
    if (!req.params.idUser) return res.sendStatus(400);
    if (!canActOnUser(req, req.params.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const user = await userModel.getUserById(req.params.idUser);

    await userModel.playStopDiet(req.params.idUser, req.params.dietInUse);

    const user2 = await userModel.getUserById(req.params.idUser);

    return res.send(user2);
  },

  // TODO: Optimizar
  async addFavoriteProduct(req, res) {
    if (!req.body.idProduct) return res.sendStatus(400);
    if (!req.body.idUser) return res.sendStatus(400);
    if (!canActOnUser(req, req.body.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    const user = await userModel.getUserById(req.body.idUser);

    const productExist = !!user.archivedProducts.find((apTemp) => {
      const id = apTemp.toString().match(/^[0-9a-fA-F]{24}$/);
      return id && id[0] === req.body.idProduct;
    });

    const newUser = await userModel.addFavouriteProduct(
      req.body.idUser,
      req.body.idProduct,
      productExist,
    );

    return res.send({
      isFavorite: !productExist,
      message: !productExist
        ? "Product added to favorites"
        : "Product removed from favorites",
    });
  },

  async addFavoriteRecipe(req, res) {
    if (!req.body.idRecipe) return res.sendStatus(400);
    if (!req.body.idUser) return res.sendStatus(400);
    if (!canActOnUser(req, req.body.idUser)) {
      return res.status(403).send({ message: "No tienes permiso para esta acci\u00f3n" });
    }

    let user = await userModel.getUserById(req.body.idUser);

    let recipeExist;
    // Check in archivedRecipes
    recipeExist = !!user.archivedRecipes.find((apTemp) => {
      const id = apTemp.toString().match(/^[0-9a-fA-F]{24}$/);
      return id[0] === req.body.idRecipe;
    });
    recipeExist = !!user.archivedRecipes.find((apTemp) => {
      const id = apTemp.toString().match(/^[0-9a-fA-F]{24}$/);
      return id[0] === req.body.idRecipe;
    });

    user = await userModel.addFavouriteRecipe(
      req.body.idUser,
      req.body.idRecipe,
      req.body.isOwn,
      recipeExist,
    );

    return res.send({
      isFavorite: !recipeExist,
      message: !recipeExist
        ? "Recipe added to favorites"
        : "Recipe removed from favorites",
    });
  },

  async updatePassword(req, res) {
    const user = await userModel.updatePassword(req.params.email, req.params.password);
    if (user?._id) {
      await clearUserAuth(user._id);
    }
    return res.send(
      htmlFinalResponse1 + "Contraseña actualizada" + htmlFinalResponse2,
    );
  },

  async sendMailCode(req, res) {
    try {
      await userModel.sendMailCode(req.params.email);
    } catch (error) {
      console.warn("[AUTH] password_reset_code_request_not_completed", {
        reason: error?.message || "unknown",
      });
    }

    return res.status(200).send(PASSWORD_RESET_REQUEST_RESPONSE);
  },

  async checkRestoreCode(req, res) {
    try {
      const response = await userModel.checkRestoreCode(
        req.body.email,
        req.body.password,
        req.body.hash,
      );
      if (response?._id) {
        await clearUserAuth(response._id);
      }
      return res.send(response);
    } catch (error) {
      console.warn("[AUTH] password_reset_code_rejected", {
        reason: error?.message || "unknown",
      });
      return res.status(400).send(PASSWORD_RESET_INVALID_CODE_RESPONSE);
    }
  },

  async sendSuggestions(req, res) {
    try {
      await userModel.sendSuggestions(req.body.email, req.body.suggestions);
      return res.sendStatus(204);
    } catch (error) {
      console.error("Error al enviar sugerencia por email:", error);
      return res.status(503).send({
        message: "No se pudo enviar el correo de sugerencia. Verifica la configuración SMTP.",
        error: error.message,
      });
    }
  },

  async verifyPassword(req, res) {
    try {
      const { password } = req.body || {};
      if (!password) {
        return res.status(400).send({ message: "Contraseña requerida" });
      }

      // Siempre sobre el usuario autenticado (del token), nunca sobre un id
      // arbitrario del body/params, para que no se pueda usar para tantear
      // la contraseña de otra cuenta.
      const user = await userModel.getUserById(req.user.id);
      if (!user) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      if (!user.password) {
        // Cuenta social (Google/Apple) sin contraseña propia: nada que verificar.
        return res.status(400).send({
          message: "Esta cuenta no tiene contraseña configurada",
          code: "NO_PASSWORD_SET",
        });
      }

      const isMatch = bcrypt.comparePasswords(password, user.password);
      if (!isMatch) {
        return res.status(401).send({ message: "Contraseña incorrecta" });
      }

      return res.status(200).send({ valid: true });
    } catch (error) {
      console.error("Error al verificar la contraseña:", error);
      return res
        .status(500)
        .send({ message: "Error al verificar la contraseña" });
    }
  },

  async deleteUser(req, res) {
    await userModel.deleteUser(req.params.id);
    res.sendStatus(204);
  },

  async checkHash(req, res) {
    const user = await userModel.checkHash(req.params.id, req.params.hash);

    // Generar HTML dinámicamente con el título correcto
    const headerMessage = user ? "¡Cuenta activada!" : "Ha habido un problema";
    const message = user ? htmlFinalContent1 : htmlFinalContent2;

    // Reemplazar placeholder con el mensaje correcto
    const finalHTML =
      htmlFinalResponse1.replace("{{HEADER_MESSAGE}}", headerMessage) +
      message +
      htmlFinalResponse2;

    res.send(finalHTML);
  },

  async impersonateUser(req, res) {
    try {
      const adminRoles = req.userData?.roles || [];
      if (!adminRoles.includes("admin")) {
        return res.status(403).send({
          message: "Solo administradores pueden usar esta función",
        });
      }

      const targetUserId = req.body?.userId;
      if (!targetUserId) {
        return res.status(400).send({ message: "userId requerido" });
      }

      const targetUser = await userSchema.findById(targetUserId);
      if (!targetUser) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      targetUser.lastLogin = new Date();
      await targetUser.save();

      const { accessToken } = await generateAndSetTokens(targetUser, res);

      return res.send({
        access_token: accessToken,
        user: await userDto.single(targetUser),
      });
    } catch (error) {
      console.error("Error en impersonateUser:", error);
      return res.status(500).send({
        message: "Error al impersonar usuario",
      });
    }
  },

  async logoutUser(req, res) {
    try {
      const { userId } = req.body;

      if (!userId) {
        return res.status(400).send({ message: "userId es requerido" });
      }

      const result = await userSchema.findById(userId);

      if (!result) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      await clearUserAuth(userId);

      return res.send({
        message: "Sesión cerrada correctamente",
        userId: result._id,
      });
    } catch (error) {
      console.error("Error al cerrar sesión del usuario:", error);
      return res.status(500).send({
        message: "Error al cerrar sesión del usuario",
      });
    }
  },
  async activateAccount(req, res) {
    try {
      const { email, code } = req.body;
      if (!email || !code) {
        return res.status(400).send({ message: "Faltan datos requeridos" });
      }

      const user = await userModel.getUserByEmail(email);
      if (!user) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      if (user.hash !== code) {
        return res.status(400).send({ message: "Código incorrecto" });
      }

      // Eliminar el hash y generar tokens con el método encapsulado
      await userSchema.findByIdAndUpdate(user._id, {
        $unset: { hash: 1 },
      });

      const { accessToken } = await generateAndSetTokens(user, res);

      return res.status(200).send({
        message: "Cuenta activada correctamente",
        access_token: accessToken,
        token_type: "bearer",
        theme: user.theme,
      });
    } catch (error) {
      console.error("Error al activar cuenta:", error);
      return res.status(500).send({ message: "Error interno del servidor" });
    }
  },

  async clearUserHash(req, res) {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).send({ message: "ID de usuario requerido" });
      }

      const user = await userModel.clearUserHash(id);
      if (!user) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      return res.status(200).send({ message: "Hash eliminado correctamente" });
    } catch (error) {
      console.error("Error al eliminar hash del usuario:", error);
      return res.status(500).send({ message: "Error interno del servidor" });
    }
  },

  async updateRoles(req, res) {
    try {
      const { id } = req.params;
      const { roles } = req.body;

      if (!id) {
        return res.status(400).send({ message: "ID de usuario requerido" });
      }

      if (!Array.isArray(roles) || !roles.every((r) => ["user", "admin"].includes(r))) {
        return res.status(400).send({ message: "Roles inválidos. Valores permitidos: user, admin" });
      }

      const user = await userSchema.findByIdAndUpdate(id, { roles }, { new: true });
      if (!user) {
        return res.status(404).send({ message: "Usuario no encontrado" });
      }

      return res.send({ message: "Roles actualizados", roles: user.roles });
    } catch (error) {
      console.error("Error al actualizar roles:", error);
      return res.status(500).send({ message: "Error interno del servidor" });
    }
  },

};
