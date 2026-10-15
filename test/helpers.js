import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db.js';
import { buildApp } from '../src/app.js';
import { hashPassword } from '../src/lib/crypto.js';

// Crea un'app isolata con database temporaneo e un finto server email che conserva i messaggi.
export async function setup({ smtpFails = () => false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voto-test-'));
  const cfg = loadConfig({ dataDir: dir, codeSecret: 'segreto-di-test', require2fa: false });
  const db = openDb(cfg.dbFile);
  const outbox = [];
  const mailer = {
    configured: true,
    async send(msg) {
      if (smtpFails(msg)) throw new Error('SMTP non raggiungibile');
      outbox.push(msg);
    },
  };
  db.prepare('INSERT INTO admins (username, pass_hash, created_at) VALUES (?, ?, ?)').run('admin', hashPassword('pw'), Date.now());
  const app = await buildApp({ cfg, db, mailer });
  const cleanup = async () => {
    await app.close();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { app, db, cfg, outbox, cleanup };
}

export async function login(app) {
  const res = await app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'pw' } });
  const sid = res.cookies.find((c) => c.name === 'sid').value;
  return { sid: sid };
}

export function adminPost(app, auth, url, payload = {}) {
  return app.inject({
    method: 'POST',
    url,
    payload,
    cookies: { sid: auth.sid },
    headers: { accept: 'application/json' },
  });
}

export function codesFrom(outbox) {
  return outbox.map((m) => m.text.match(/CODICE:\s+([A-Z0-9-]+)/)[1]);
}

// Export dell'anagrafica (formato del gestionale), assemblea il 31/10/2026.
export const CSV = `Codice;Cognome;Nome;Data Nascita;Cod.Fiscale;Email;Gruppo;Scad. Tessera;Stato
1;Bianchi;Giulia;12/03/1985;CF01;g@example.test;SOCI;31/12/2026;Attivo
2;Russo;Marco;04/07/1979;CF02;m@example.test;DIRETTIVO;31/10/2026;Attivo
3;Ferrari;Francesca;23/11/1990;CF03;f@example.test;SOCI;30/04/2027;Attivo
4;Esposito;Luca;02/02/1988;CF04;l@example.test;SOCI;31/12/2026;Attivo
5;Romano;Chiara;17/09/1995;CF05;c@example.test;SOCI;31/01/2027;Attivo
6;Gallo;Martina;19/08/1993;CF06;m@example.test;SOCI;31/01/2027;Attivo
7;Conti;Tommaso;01/11/2008;CF07;c@example.test;SOCI;31/12/2026;Attivo
8;Greco;Elena;21/04/1998;CF08;e@example.test;SOCI;30/10/2026;Attivo
9;Costa;Roberto;09/09/1980;CF09;r@example.test;SOCI;31/12/2026;Sospeso
10;Bianchi;Giulia;12/03/1985;cf01;g@example.test;SOCI;31/12/2026;Attivo
11;De Luca;Anna;11/11/1991;CF11;a@example.test;SOCI;31/12/2026;Attivo
12;Neri;Paolo;31/10/2008;CF12;p@example.test;COLLABORATORI;31/12/2026;Attivo
13;Verdi;Luisa;05/05/1990;CF13;;SOCI;;Attivo
`;
