import nodemailer from "nodemailer";

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

export async function sendAppEmail({ to, subject, html, devLink }) {
  if (!hasSmtpConfig()) {
    console.log(`[Email dev mode] ${subject} for ${to}: ${devLink}`);
    return { sent: false, devLink };
  }

  const transporter = createTransporter();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to,
    subject,
    html,
  });

  return { sent: true };
}
