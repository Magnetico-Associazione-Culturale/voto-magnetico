// Invio email (solo per i codici di voto). In sviluppo le email finiscono in Mailpit.
import nodemailer from 'nodemailer';

export function createMailer(cfg) {
  if (!cfg.smtp.host) {
    return {
      configured: false,
      async send() {
        throw new Error('Server email (SMTP) non configurato: imposta SMTP_HOST nel file .env');
      },
    };
  }
  const transport = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
    pool: true,
    maxConnections: 3,
  });
  return {
    configured: true,
    async send({ to, subject, text }) {
      await transport.sendMail({ from: cfg.smtp.from, to, subject, text });
    },
  };
}
