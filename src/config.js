// Configurazione letta dalle variabili d'ambiente (file .env in produzione).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const pkg = createRequire(import.meta.url)('../package.json');

const env = process.env;

export function loadConfig(overrides = {}) {
  const dataDir = overrides.dataDir ?? env.DATA_DIR ?? path.resolve('data');
  fs.mkdirSync(dataDir, { recursive: true });

  const cfg = {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbFile: overrides.dbFile ?? path.join(dataDir, 'voto.sqlite'),
    // Indirizzo pubblico usato per QR code e link (es. https://voto.magnetico.cloud).
    // Se vuoto si usa l'host con cui è stato aperto il pannello.
    publicUrl: (env.PUBLIC_URL ?? '').replace(/\/+$/, ''),
    // In produzione la verifica a due fattori è obbligatoria per gli amministratori.
    require2fa: (env.REQUIRE_2FA ?? (env.NODE_ENV === 'production' ? '1' : '0')) === '1',
    // Dietro Caddy: ci si fida solo del primo salto, così l'IP non si falsifica con X-Forwarded-For.
    trustProxy: env.TRUST_PROXY === '1' ? 1 : false,
    devSeed: env.DEV_SEED === '1',
    // Versione mostrata in fondo a ogni pagina: in produzione è l'etichetta Git (es. v1.0.0).
    version: env.APP_VERSION || `${pkg.version}-dev`,
    smtp: {
      host: env.SMTP_HOST ?? '',
      port: Number(env.SMTP_PORT ?? 587),
      secure: env.SMTP_SECURE === '1',
      user: env.SMTP_USER ?? '',
      pass: env.SMTP_PASS ?? '',
      from: env.MAIL_FROM ?? 'Votazioni Magnetico <noreply@magnetico.cloud>',
    },
    ...overrides,
  };

  cfg.secureCookies = cfg.publicUrl.startsWith('https://');
  cfg.codeSecret = overrides.codeSecret ?? loadOrCreateSecret(dataDir);
  return cfg;
}

// Chiave segreta usata per l'HMAC dei codici di voto. Generata al primo avvio
// e conservata nella cartella dati (mai nel repository).
function loadOrCreateSecret(dataDir) {
  if (env.CODE_SECRET) return env.CODE_SECRET;
  const file = path.join(dataDir, '.code-secret');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  return fs.readFileSync(file, 'utf8').trim();
}
