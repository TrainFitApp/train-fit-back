const nodemailer = require("nodemailer");
const dns = require("dns").promises;
const { EMAIL_FORMAT_REGEX } = require("./normalize-email");
// Correo saliente: todo sale por el SMTP de Resend desde @trainfit.net,
// también los avisos internos (registro y sugerencias). Las respuestas
// llegan por Cloudflare Email Routing (docs/plan-correo-resend.md).
const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.FROM_EMAIL || "registro@trainfit.net";
// Buzón al que llegan las respuestas de los usuarios a los correos transaccionales.
const supportEmail = process.env.SUPPORT_EMAIL || "soporte@trainfit.net";
const notificationsFromEmail = process.env.NOTIFICATIONS_FROM_EMAIL || "avisos@trainfit.net";

// Destinatarios de los avisos internos.
const registrationNotificationEmail = process.env.REGISTRATION_NOTIFICATION_EMAIL;
const suggestionsNotificationEmail = process.env.SUGGESTIONS_NOTIFICATION_EMAIL || registrationNotificationEmail;

// SMTP de Resend: usuario fijo "resend" y la API key como contraseña.
const transporter = nodemailer.createTransport({
  host: "smtp.resend.com",
  port: 465,
  secure: true,
  auth: { user: "resend", pass: resendApiKey },
  tls: { minVersion: "TLSv1.2" },
});

if (resendApiKey) {
  transporter
    .verify()
    .then(() => console.log("Resend SMTP ready"))
    .catch((error) => console.warn("Resend SMTP verify failed:", error?.message || error));
} else {
  console.warn("Resend SMTP sin credenciales: no se enviarán correos");
}

/**
 * Valida que un email tenga formato correcto y dominio con registros MX válidos
 * @param {string} email - Email a validar
 * @returns {Promise<boolean>} - true si es válido y el dominio existe
 */
const validateEmailExists = async (email) => {
  try {
    // Validar formato básico
    if (!EMAIL_FORMAT_REGEX.test(email)) {
      return false;
    }

    // Extraer dominio
    const domain = email.split("@")[1];
    if (!domain) {
      return false;
    }

    // Verificar registros MX del dominio
    try {
      const mxRecords = await dns.resolveMx(domain);
      return mxRecords && mxRecords.length > 0;
    } catch (dnsError) {
      console.warn(`DNS MX lookup failed for domain ${domain}:`, dnsError.code);
      // Si el error es ETIMEOUT, SERVFAIL, etc., asumimos que puede ser válido para no bloquear
      // Solo rechazamos explícitamente si el dominio no existe (ENOTFOUND) o no tiene MX (ENODATA)
      if (dnsError.code === "ENOTFOUND" || dnsError.code === "ENODATA") {
        return false;
      }
      return true; // Ante la duda por fallos de red, permitimos el registro
    }
  } catch (error) {
    console.error("Error validating email:", error);
    return false;
  }
};

// Sugerencias que los usuarios envían desde la app. Llegan al buzón interno
// y al responder se contesta directamente al usuario.
const sendSuggestionMail = async (userEmail, suggestions) => {
  if (!suggestionsNotificationEmail) {
    throw new Error("SUGGESTIONS_NOTIFICATION_EMAIL no configurado");
  }
  const html = `<p>${escapeHtml(suggestions).replace(/\n/g, "<br />")}</p>`;
  return transporter.sendMail({
    from: { name: "TrainFit Sugerencias", address: notificationsFromEmail },
    replyTo: userEmail || notificationsFromEmail,
    to: suggestionsNotificationEmail,
    subject: `Sugerencia de: ${userEmail}`,
    html,
    text: htmlToText(html),
  });
};

const sendRegisterMail = async (to, subject, html, options = {}) => {
  const sender = options.from || notificationsFromEmail;
  const mailOptions = {
    from: {
      name: options.fromName || "TrainFit",
      address: sender,
    },
    replyTo: options.replyTo || sender,
    to,
    subject,
    html,
    text: htmlToText(html),
  };

  return transporter.sendMail(mailOptions);
};

/**
 * Convierte HTML a texto plano para mejorar la puntuación de spam
 * Los emails con versión de texto plano tienen mejor entregabilidad
 */
const htmlToText = (html) => {
  if (!html) return "";
  let text = String(html);

  // Eliminar preheader span oculto ANTES de procesar (evita caracteres especiales en texto plano)
  text = text.replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "");

  // Saltos de línea y párrafos
  text = text.replace(/<br\s*\/>|<br\s*>/gi, "\n");
  text = text.replace(/<p\b[^>]*>/gi, "");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, "\n");
  text = text.replace(/<\/h[1-6]>/gi, "\n\n");

  // Enlaces: texto (url)
  text = text.replace(
    /<a\b[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi,
    "$2 ($1)",
  );

  // Elimina el resto de etiquetas HTML
  text = text.replace(/<[^>]+>/g, "");

  // Decodifica entidades HTML
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&zwnj;/g, "");
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#847;/g, "");
  text = text.replace(/&#8199;/g, "");
  text = text.replace(/&#65279;/g, "");

  // Limpieza de espacios y saltos
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
};

// Correo transaccional a usuarios (verificación, contraseña, invitaciones,
// avisos de facturación).
// options.replyTo: buzón al que responde el usuario (p. ej. facturación en los avisos de Trainers).
const sendTransactionalMail = async (to, subject, html, options = {}) => {
  const text = htmlToText(html);
  const replyTo = options.replyTo || supportEmail;

  const headers = {
    "List-Unsubscribe": `<mailto:${fromEmail}>`,
    "X-Auto-Response-Suppress": "OOF, AutoReply",
  };
  return transporter.sendMail({
    from: { name: "TrainFit", address: fromEmail },
    replyTo,
    to,
    subject,
    html,
    text,
    headers,
  });
};

/**

 *
 * @param {string} header1      Título principal del email (H1)
 * @param {string} description  Párrafo descriptivo
 * @param {string} linkHref     URL del botón CTA
 * @param {string} linkContent  Texto del botón
 */
const generateMail = (header1, description, linkHref, linkContent) => {
  // Preheader text mejorado basado en el contenido
  const preheader =
    description?.substring(0, 100) ||
    "Activa tu cuenta de TrainFit para comenzar tu transformación física.";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//ES" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="es">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Activación de cuenta - TrainFit</title>
    <!-- Preheader text: se muestra en preview pero no en el email -->
    <span style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>
  </head>
  <body style='background-color:#F3F4F6;font-family:ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol";padding-top:40px;padding-bottom:40px;margin:0;'>
    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:8px;margin:0 auto;padding:20px;max-width:600px">
      <tbody>
        <tr style="width:100%">
          <td>
            <h1 style="font-size:24px;font-weight:700;text-align:center;margin:30px 0;color:#000000">
              ${header1 || "¡Bienvenido/a!"}
            </h1>

            <p style="font-size:16px;line-height:24px;color:#374151;margin:16px 0">
              ${
                description ||
                "Gracias por registrarte. Pulsa el botón de abajo para activar tu cuenta."
              }
            </p>

            <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="text-align:center;margin-bottom:32px">
              <tbody>
                <tr>
                  <td>
                    <a href="${linkHref}"
                      target="_blank"
                      style="background-color:#FE9000;color:#ffffff;font-weight:700;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;line-height:120%;box-sizing:border-box;max-width:100%;">
                      ${linkContent || "Activar cuenta"}
                    </a>
                  </td>
                </tr>
              </tbody>
            </table>

            <p style="font-size:14px;line-height:22px;color:#374151;margin:8px 0">
              Este enlace caduca en 24 horas.
            </p>
            <p style="font-size:14px;line-height:22px;color:#374151;margin:16px 0 32px 0">
              Si no has creado una cuenta, ignora este correo.
            </p>

            <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;width:100%;" />

            <p style="font-size:12px;line-height:16px;color:#6B7280;margin:4px 0">
              Para cualquier duda, escribe a <strong>soporte@trainfit.net</strong>
            </p>
            <p style="font-size:12px;line-height:16px;color:#6B7280;margin:0">
              © ${new Date().getFullYear()} TrainFit. Todos los derechos reservados.
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
};

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatMailValue = (value) => {
  if (value === undefined || value === null || value === "")
    return "No informado";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.length ? value.join(", ") : "No informado";
  if (typeof value === "object") {
    if (value._id) return value._id.toString();
    if (
      typeof value.toString === "function" &&
      value.toString() !== "[object Object]"
    ) {
      return value.toString();
    }
    return JSON.stringify(value);
  }
  return String(value);
};

const getUserPlainObject = (user) => {
  if (!user) return {};
  if (typeof user.toObject === "function") return user.toObject();
  return user;
};

const formatRegistrationDate = (value) => {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return formatMailValue(value);

  return date.toLocaleString("es-ES", {
    timeZone:
      process.env.REGISTRATION_NOTIFICATION_TIME_ZONE || "Europe/Madrid",
  });
};

const buildDetailRows = (details) =>
  details
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;color:#6B7280;font-size:13px;width:38%;vertical-align:top">
            ${escapeHtml(label)}
          </td>
          <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;color:#111827;font-size:13px;font-weight:600;vertical-align:top">
            ${escapeHtml(formatMailValue(value))}
          </td>
        </tr>`,
    )
    .join("");

const generateRegistrationNotificationMail = (user, context = {}) => {
  const userData = getUserPlainObject(user);
  const createdAt = userData.createdAt || context.createdAt || new Date();
  const details = [
    ["Correo electronico", userData.email],
    ["Name", userData.name],
    ["Lastname", userData.lastname],
    ["Fecha de registro", formatRegistrationDate(createdAt)],
  ];

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//ES" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="es">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Registro - TrainFit</title>
    <span style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">Registro ${escapeHtml(userData.email || "")}</span>
  </head>
  <body style='background-color:#F3F4F6;font-family:ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol";padding-top:40px;padding-bottom:40px;margin:0;'>
    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:12px;margin:0 auto;padding:24px;max-width:640px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">
      <tbody>
        <tr style="width:100%">
          <td>
            <div style="text-align:center;margin:0 0 16px 0">
              <span style="display:inline-block;background-color:#FE9000;color:#ffffff;font-weight:700;padding:6px 12px;border-radius:9999px;font-size:12px;letter-spacing:.3px">TrainFit</span>
            </div>

            <h1 style="font-size:24px;font-weight:700;text-align:center;margin:14px 0 8px 0;color:#111827">
              Registro
            </h1>

            <p style="font-size:16px;line-height:24px;color:#374151;margin:8px 0 20px 0;text-align:center">
              Se ha registrado un nuevo usuario en TrainFit.
            </p>

            <table width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="border:1px solid #E5E7EB;border-radius:8px;border-collapse:separate;overflow:hidden;margin:20px 0">
              <tbody>
                ${buildDetailRows(details)}
              </tbody>
            </table>

            <p style="font-size:12px;line-height:16px;color:#6B7280;margin:4px 0;text-align:center">
              Este aviso se envia automaticamente desde la cuenta de registro.
            </p>
            <p style="font-size:12px;line-height:16px;color:#6B7280;margin:0;text-align:center">
              © ${new Date().getFullYear()} TrainFit. Todos los derechos reservados.
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
};

const sendRegistrationNotification = async (user, context = {}) => {
  if (!registrationNotificationEmail) {
    throw new Error("REGISTRATION_NOTIFICATION_EMAIL no configurado");
  }

  const userData = getUserPlainObject(user);
  const subjectEmail = userData.email || "sin email";
  const html = generateRegistrationNotificationMail(user, context);

  return sendRegisterMail(
    registrationNotificationEmail,
    `Registro '${subjectEmail}'`,
    html,
    {
      fromName: "TrainFit Registros",
      replyTo: userData.email || undefined,
    },
  );
};

const notifyUserRegistered = (user, context = {}) => {
  sendRegistrationNotification(user, context).catch((error) => {
    console.error(
      "Error enviando aviso interno de registro:",
      error?.message || error,
    );
  });
};

/**
 * Plantilla de correo para mostrar un código/hash de verificación
 *
 * @param {string} header1      Título principal del email (H1)
 * @param {string} description  Párrafo descriptivo
 * @param {string} hash         Código/hash a mostrar
 */
const generateHashMail = (header1, description, hash) => {
  const year = new Date().getFullYear();
  const safeHash = (hash || "").toString();

  // Preheader text con el código visible en el preview
  const preheader = `Tu código de verificación es: ${safeHash}`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//ES" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html dir="ltr" lang="es">
  <head>
    <meta content="text/html; charset=UTF-8" http-equiv="Content-Type" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Código de verificación • TrainFit</title>
    <!-- Preheader text con el código -->
    <span style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</span>
  </head>
  <body style='background-color:#F3F4F6;font-family:ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol";padding-top:40px;padding-bottom:40px;margin:0;'>
    <table align="center" width="100%" border="0" cellpadding="0" cellspacing="0" role="presentation" style="background-color:#ffffff;border-radius:12px;margin:0 auto;padding:24px;max-width:600px;box-shadow:0 1px 2px rgba(0,0,0,0.04)">
      <tbody>
        <tr style="width:100%">
          <td>
            <div style="text-align:center;margin:0 0 16px 0">
              <span style="display:inline-block;background-color:#FE9000;color:#ffffff;font-weight:700;padding:6px 12px;border-radius:9999px;font-size:12px;letter-spacing:.3px">TrainFit</span>
            </div>

            <h1 style="font-size:24px;font-weight:700;text-align:center;margin:14px 0 8px 0;color:#111827">
              ${header1 || "Verifica tu cuenta"}
            </h1>

            <p style="font-size:16px;line-height:24px;color:#374151;margin:8px 0 20px 0;text-align:center">
              ${
                description ||
                "Introduce el siguiente código en la app para continuar."
              }
            </p>

            <div style="text-align:center;margin:20px 0 8px 0">
              <div style="display:inline-block;background-color:#FFF3E6;color:#8A3A00;border:1px solid #FFB566;border-radius:12px;padding:16px 24px;">
                <span style="font-family:SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono','Courier New',monospace;font-size:24px;letter-spacing:4px;line-height:30px;display:block;">
                  ${safeHash.toUpperCase()}
                </span>
              </div>
            </div>

            <hr style="border:none;border-top:1px solid #E5E7EB;margin:24px 0;width:100%;" />

            <p style="font-size:12px;line-height:16px;color:#6B7280;margin:4px 0;text-align:center">
              Si no solicitaste este código, ignora este correo.
            </p>
            <p style="font-size:12px;line-height:16px;color:#6B7280;margin:0;text-align:center">
              © ${year} TrainFit. Todos los derechos reservados.
            </p>
          </td>
        </tr>
      </tbody>
    </table>
  </body>
</html>`;
};

module.exports = {
  sendSuggestionMail,
  sendRegisterMail,
  sendTransactionalMail,
  generateMail,
  generateHashMail,
  generateRegistrationNotificationMail,
  sendRegistrationNotification,
  notifyUserRegistered,
  validateEmailExists,
};
