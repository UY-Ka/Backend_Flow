import nodemailer from "nodemailer";

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "false") === "true";

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!SMTP_USER || !SMTP_PASS) {
    throw new Error(
      "SMTP не настроен. Укажите SMTP_USER и SMTP_PASS в backend/.env"
    );
  }

  // Универсальный SMTP: можно использовать Gmail/Yandex/Mail.ru через .env.
  // Если SMTP_HOST не указан — fallback на Gmail service.
  const transportConfig = SMTP_HOST
    ? {
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      }
    : {
        service: "gmail",
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      };

  transporter = nodemailer.createTransport(transportConfig);

  return transporter;
}

async function sendEmail({ to, subject, html }) {
  const t = getTransporter();
  await t.sendMail({
    from: SMTP_FROM,
    to,
    subject,
    html,
  });
}

export async function sendVerificationCodeEmail({ to, code }) {
  return sendEmail({
    to,
    subject: "Код подтверждения регистрации",
    html: `<p>Ваш код подтверждения: <b>${code}</b></p><p>Код действует 10 минут.</p>`,
  });
}

export async function sendPasswordResetCodeEmail({ to, code }) {
  return sendEmail({
    to,
    subject: "Код восстановления пароля",
    html: `<p>Ваш код для сброса пароля: <b>${code}</b></p><p>Код действует 10 минут.</p>`,
  });
}

