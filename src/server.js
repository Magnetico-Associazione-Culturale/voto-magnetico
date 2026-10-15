import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createMailer } from './mailer.js';
import { buildApp } from './app.js';
import { closeExpired } from './services/elections.js';
import { seedIfEmpty, DEV_ADMIN } from './seed.js';

const cfg = loadConfig();
const db = openDb(cfg.dbFile);
const mailer = createMailer(cfg);

if (cfg.devSeed && process.env.NODE_ENV === 'production') {
  console.log('[avviso] DEV_SEED ignorato in produzione: nessun utente di prova viene creato.');
} else if (cfg.devSeed && seedIfEmpty(db)) {
  console.log(`[prova] Creati dati di prova. Accesso: ${DEV_ADMIN.username} / ${DEV_ADMIN.password}`);
}
if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) {
  console.log('[avviso] Nessun amministratore. Creane uno con:  npm run cli -- crea-admin <nome>');
}

// Chiusura automatica dei turni scaduti, anche se nessuno sta guardando lo schermo.
setInterval(() => {
  try {
    closeExpired(db);
  } catch (err) {
    console.error('[errore] chiusura automatica:', err.message);
  }
}, 500).unref();

const app = await buildApp({ cfg, db, mailer });
await app.listen({ port: cfg.port, host: cfg.host });
console.log(`Piattaforma di voto (versione ${cfg.version}) in ascolto sulla porta ${cfg.port}`);
if (cfg.publicUrl) console.log(`Indirizzo pubblico: ${cfg.publicUrl}`);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await app.close();
    db.close();
    process.exit(0);
  });
}
