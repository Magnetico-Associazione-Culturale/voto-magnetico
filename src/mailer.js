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
  // Nome con cui il server si presenta (EHLO). Il relay SMTP di Google rifiuta i nomi
  // che non sono un dominio vero, come l'identificativo interno del container.
  let ehlo;
  try {
    ehlo = cfg.publicUrl ? new URL(cfg.publicUrl).hostname : undefined;
  } catch {
    ehlo = undefined;
  }
  const transport = nodemailer.createTransport({
    name: ehlo,
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
