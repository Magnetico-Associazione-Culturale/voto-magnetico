// Dati di prova per lo sviluppo locale (DEV_SEED=1). Mai in produzione.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './lib/crypto.js';
import { createElection, addQuestion, addCandidate } from './services/elections.js';
import { importEligibles, importVoters } from './services/voters.js';

export const DEV_ADMIN = { username: 'admin', password: 'prova1234' };

export function seedIfEmpty(db) {
  if (db.prepare('SELECT 1 FROM admins LIMIT 1').get()) return false;
  db.prepare('INSERT INTO admins (username, pass_hash, created_at) VALUES (?, ?, ?)').run(
    DEV_ADMIN.username,
    hashPassword(DEV_ADMIN.password),
    Date.now(),
  );
  const eid = createElection(db, { title: 'Assemblea di prova – Elezione del Consiglio Direttivo', assemblyDate: '2026-10-31', durationMin: 5 });
  const qid = addQuestion(db, eid, { title: 'Consiglio Direttivo', seats: 3, maxPrefs: 3, allowWriteIn: true });
  for (const n of ['Giulia Bianchi', 'Marco Russo', 'Francesca Ferrari', 'Luca Esposito', 'Chiara Romano']) addCandidate(db, qid, n);
  const csv = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'esempio-elenco.csv'), 'utf8');
  // Stesso file per eleggibili e presenti, come se fossero venuti tutti.
  importEligibles(db, eid, { csv });
  importVoters(db, eid, { csv });
  return true;
}
