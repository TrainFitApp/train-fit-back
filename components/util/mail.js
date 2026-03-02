const nodemailer = require("nodemailer");
const suggestionsHost = process.env.SUGGESTIONS_MAIL_SENDER_HOST;
const suggestionsPort = process.env.SUGGESTIONS_MAIL_SENDER_PORT;
const suggestionsUser = process.env.SUGGESTIONS_MAIL_SENDER_USER;
const suggestionsPass = process.env.SUGGESTIONS_MAIL_SENDER_PASS;
const sesSmtpUser = process.env.SES_SMTP_USER;
const sesSmtpPass = process.env.SES_SMTP_PASS;
const sesRegion = process.env.SES_REGION;
const fromEmail = process.env.FROM_EMAIL;

const suggestionsSecure = String(suggestionsPort) === "465";
const suggestionsTransporter = nodemailer.createTransport({
  host: suggestionsHost,
  port: Number(suggestionsPort),
  secure: suggestionsSecure,
  auth: { user: suggestionsUser, pass: suggestionsPass },
  tls: { minVersion: "TLSv1.2" },
});

const sesTransporter = nodemailer.createTransport({
  host: `email-smtp.eu-west-3.amazonaws.com`,
  port: 587,
  secure: false,
  auth: {
    user: "AKIA5CBGTKIMMRREJWZG",
    pass: "BCeXPzQ0CMqshyQE8liQT9jNKCKZ70csYy4jT1ePbXi2",
  },
  tls: { minVersion: "TLSv1.2" },
});

Promise.allSettled([
  suggestionsTransporter.verify(),
  sesTransporter.verify(),
]).then((results) => {
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      console.log(i === 0 ? "Suggestions SMTP ready" : "SES SMTP ready");
    } else {
      console.warn(
        i === 0 ? "Suggestions SMTP verify failed:" : "SES SMTP verify failed:",
        r.reason?.message || r.reason
      );
    }
  });
});

const sendMail = async (sender, to, subject, html) => {
  const mailOptions = { from: sender, to, subject, html };
  return suggestionsTransporter.sendMail(mailOptions);
};

/**
 * Convierte HTML a texto plano para mejorar la puntuación de spam
 * Los emails con versión de texto plano tienen mejor entregabilidad
 */
const htmlToText = (html) => {
  if (!html) return "";
  let text = String(html);

  // Eliminar preheader span oculto ANTES de procesar (evita caracteres especiales en texto plano)
  text = text.replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, '');

  // Saltos de línea y párrafos
  text = text.replace(/<br\s*\/>|<br\s*>/gi, "\n");
  text = text.replace(/<p\b[^>]*>/gi, "");
  text = text.replace(/<\/p>/gi, "\n\n");
  text = text.replace(/<\/div>/gi, '\n');
  text = text.replace(/<\/h[1-6]>/gi, '\n\n');

  // Enlaces: texto (url)
  text = text.replace(
    /<a\b[^>]*href=\"([^\"]*)\"[^>]*>(.*?)<\/a>/gi,
    "$2 ($1)"
  );

  // Elimina el resto de etiquetas HTML
  text = text.replace(/<[^>]+>/g, "");

  // Decodifica entidades HTML
  text = text.replace(/&nbsp;/g, " ");
  text = text.replace(/&zwnj;/g, '');
  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&#847;/g, '');
  text = text.replace(/&#8199;/g, '');
  text = text.replace(/&#65279;/g, '');

  // Limpieza de espacios y saltos
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
};

const sendMailSES = async (to, subject, html) => {
  const text = htmlToText(html);

  const mailOptions = {
    from: {
      name: "TrainFit",
      address: fromEmail || "registro@trainfit.net",
    },
    replyTo: fromEmail || "registro@trainfit.net",
    to,
    subject,
    html,
    text,

    headers: {
      "List-Unsubscribe": `<mailto:${fromEmail || "registro@trainfit.net"}>`,
      "Reply-To": fromEmail || "registro@trainfit.net",
      "X-Mailer": "TrainFit Mailer v1.0",
      "X-Priority": "3",
      "X-Auto-Response-Suppress": "OOF, AutoReply",

      // ⛔ NO ELIMINAR
      "X-SES-CONFIGURATION-SET": "TrainFitConfig",
    },
  };

  return sesTransporter.sendMail(mailOptions);
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
  const preheader = description?.substring(0, 100) || "Activa tu cuenta de TrainFit para comenzar tu transformación física.";

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
              ${description ||
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
              ${description ||
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

module.exports = { sendMail, sendMailSES, generateMail, generateHashMail };
