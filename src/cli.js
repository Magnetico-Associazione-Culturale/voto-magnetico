// Comandi di amministrazione da terminale.
//   npm run cli -- crea-admin <nome>       crea un amministratore (password generata)
//   npm run cli -- reset-password <nome>   genera una nuova password
//   npm run cli -- reset-2fa <nome>        disattiva la verifica a due fattori (va riattivata al login)
//   npm run cli -- elimina-admin <nome>
//   npm run cli -- lista-admin
import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { hashPassword } from './lib/crypto.js';

const [cmd, name] = process.argv.slice(2);
const db = openDb(loadConfig().dbFile);

const newPassword = () => crypto.randomBytes(12).toString('base64url');
const need = () => {
  if (!name) {
    console.error('Specifica il nome utente.');
    process.exit(1);
  }
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(name);
};
const log = (action) =>
  db.prepare('INSERT INTO admin_log (at, username, election_id, action) VALUES (?, ?, NULL, ?)').run(Date.now(), 'terminale', action);

switch (cmd) {
  case 'crea-admin': {
    if (need()) {
      console.error(`L'utente ${name} esiste già.`);
      process.exit(1);
    }
    const pw = newPassword();
    db.prepare('INSERT INTO admins (username, pass_hash, created_at) VALUES (?, ?, ?)').run(name, hashPassword(pw), Date.now());
    log(`Amministratore creato: ${name}`);
    console.log(`Amministratore creato.\n  utente:   ${name}\n  password: ${pw}\nAl primo accesso ti verrà chiesto di attivare la verifica a due fattori.`);
    break;
  }
  case 'reset-password': {
    if (!need()) throw new Error('Utente non trovato');
    const pw = newPassword();
    db.prepare('UPDATE admins SET pass_hash = ? WHERE username = ?').run(hashPassword(pw), name);
    db.prepare('DELETE FROM sessions WHERE admin_id = (SELECT id FROM admins WHERE username = ?)').run(name);
    log(`Password reimpostata: ${name}`);
    console.log(`Nuova password per ${name}: ${pw}`);
    break;
  }
  case 'reset-2fa': {
    if (!need()) throw new Error('Utente non trovato');
    db.prepare('UPDATE admins SET totp_secret = NULL WHERE username = ?').run(name);
    db.prepare('DELETE FROM sessions WHERE admin_id = (SELECT id FROM admins WHERE username = ?)').run(name);
    log(`Verifica a due fattori azzerata: ${name}`);
    console.log(`Verifica a due fattori azzerata per ${name}: andrà riattivata al prossimo accesso.`);
    break;
  }
  case 'elimina-admin': {
    if (!need()) throw new Error('Utente non trovato');
    db.prepare('DELETE FROM admins WHERE username = ?').run(name);
    log(`Amministratore eliminato: ${name}`);
    console.log(`Amministratore ${name} eliminato.`);
    break;
  }
  case 'lista-admin':
    for (const a of db.prepare('SELECT username, totp_secret FROM admins ORDER BY username').all()) {
      console.log(`${a.username}${a.totp_secret ? '' : '   (verifica a due fattori NON attiva)'}`);
    }
    break;
  default:
    console.log('Comandi: crea-admin <nome> | reset-password <nome> | reset-2fa <nome> | elimina-admin <nome> | lista-admin');
}
db.close();
