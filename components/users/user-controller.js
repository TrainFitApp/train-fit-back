const userService = require("./user-service");
const mail = require("./../util/mail");
const { normalizeEmail } = require("../util/normalize-email");
const { badRequest, forbidden, notFound } = require("../util/http-error");
const { normalizeTimeZone } = require("../util/date-util");

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
              Si tienes alguna pregunta, por favor contacta con nuestro equipo de soporte en soporte@trainfit.net
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

function assertCanActOnUser(req, targetUserId, message = "No tienes permiso para esta acción") {
  if (!isAdmin(req) && String(req.user?.id) !== String(targetUserId)) throw forbidden(message);
}

function notifyUserRegistered(user, req, source) {
  mail.notifyUserRegistered(user, {
    source,
    provider: user?.provider || "email",
    ip: req.ip,
    userAgent: req.headers?.["user-agent"],
  });
}

const ROLES_ASSIGNABLE = ["user", "admin"];

module.exports = {
  // Público. Un registro social a medias (cuenta sin nombre) no cuenta: ese
  // correo todavía puede completar el alta.
  async checkEmail(req, res) {
    const email = normalizeEmail(req.params?.email);
    if (!email) throw badRequest("Email requerido");
    const user = await userService.getUserByEmail(email);
    res.send({ emailExist: Boolean(user?.name) });
  },

  // Las apps solo lo usan para cargar el usuario PROPIO (user-loader,
  // sign-in, onboarding-status): el perfil de otra cuenta responde 404, como
  // si no existiera.
  async getUserByEmail(req, res) {
    const email = normalizeEmail(req.params.email);
    if (!isAdmin(req) && email !== normalizeEmail(req.user?.email)) throw notFound("Usuario no encontrado");
    res.send(await userService.view(await userService.getUserByEmail(email)));
  },

  async searchUsers(req, res) {
    const { page, search, filters } = req.body;
    res.send(await userService.searchUsers(page, 10, search, filters || {}));
  },

  async createUser(req, res) {
    // Alta sin sesión: la zona del dispositivo viene en la cabecera, sin
    // pasar por validateAuth.
    const timeZone = normalizeTimeZone(String(req.headers?.["x-timezone"] || "").trim());
    const { user, verificationMailSent } = await userService.registerClient(normalizeEmail(req.body?.user?.email), req.body.user, timeZone);
    notifyUserRegistered(user, req, "users.createUser");
    // verificationMailSent: false = la cuenta está creada pero el correo con
    // el código no salió; la app lo dice y ofrece «Reenviar código».
    res.send({ ...(await userService.view(user, req.user)), verificationMailSent });
  },

  // Alta de profesional (TrainFit: Entrenadores). No reutiliza el alta de
  // cliente (objetivo inicial y peso): un profesional no es necesariamente
  // cliente de TrainFit.
  async createProfessionalUser(req, res) {
    const { name, lastname, email, password } = req.body || {};
    const { user, verificationMailSent } = await userService.createProfessional({ name, lastname, email: normalizeEmail(email), password });
    notifyUserRegistered(user, req, "users.createProfessionalUser");
    res.status(201).send({ ...(await userService.view(user, req.user)), verificationMailSent });
  },

  async updateUser(req, res) {
    if (!req.body?._id) throw badRequest("ID de usuario requerido");
    assertCanActOnUser(req, req.body._id.toString(), "No tienes permiso para actualizar este usuario");
    // Solo el perfil (lista blanca, users/user-profile.js) y, si viene, el
    // peso de hoy. La respuesta es el DTO: nunca el documento crudo.
    const user = await userService.updateUser(req.body, req.auth.timeZone);
    res.send(await userService.view(user, req.user));
  },

  async sendMailCode(req, res) {
    await userService.sendMailCode(normalizeEmail(req.params.email));
    res.send({ message: "Si existe una cuenta con ese correo, enviaremos un codigo de verificacion." });
  },

  // Solo { ok: true }: la app no usa el cuerpo.
  async checkRestoreCode(req, res) {
    await userService.checkRestoreCode(normalizeEmail(req.body.email), req.body.password, req.body.hash);
    res.send({ ok: true });
  },

  async sendSuggestions(req, res) {
    await userService.sendSuggestions(req.body.email, req.body.suggestions);
    res.sendStatus(204);
  },

  async verifyPassword(req, res) {
    await userService.verifyOwnPassword(req.user.id, req.body?.password);
    res.send({ valid: true });
  },

  async deleteUser(req, res) {
    if (!isAdmin(req) && String(req.user?._id) !== String(req.params.id)) {
      throw forbidden("No puedes eliminar otra cuenta.", "FORBIDDEN");
    }
    await userService.deleteUser(req.params.id);
    res.sendStatus(204);
  },

  // Enlace de activación del correo: página HTML.
  async checkHash(req, res) {
    const user = await userService.checkHash(req.params.id, req.params.hash);
    const headerMessage = user ? "¡Cuenta activada!" : "Ha habido un problema";
    const content = user ? htmlFinalContent1 : htmlFinalContent2;
    res.send(htmlFinalResponse1.replace("{{HEADER_MESSAGE}}", headerMessage) + content + htmlFinalResponse2);
  },

  async clearUserHash(req, res) {
    if (!(await userService.clearUserHash(req.params.id))) throw notFound("Usuario no encontrado");
    res.send({ message: "Hash eliminado correctamente" });
  },

  async updateRoles(req, res) {
    const { roles } = req.body;
    if (!Array.isArray(roles) || !roles.every((role) => ROLES_ASSIGNABLE.includes(role))) {
      throw badRequest("Roles inválidos. Valores permitidos: user, admin");
    }
    const user = await userService.setRoles(req.params.id, roles);
    if (!user) throw notFound("Usuario no encontrado");
    res.send({ message: "Roles actualizados", roles: user.roles });
  },
};
