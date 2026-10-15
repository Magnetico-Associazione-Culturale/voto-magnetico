// Database SQLite (file unico). Lo schema è pensato per l'anonimato:
// - i codici di voto sono salvati solo come hash (HMAC);
// - le schede stanno in una tabella separata, senza alcun riferimento al codice,
//   senza timestamp e con chiave primaria casuale (WITHOUT ROWID), così l'ordine
//   di inserimento non è ricostruibile;
// - secure_delete sovrascrive i dati cancellati.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  totp_secret TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  totp_ok INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);

-- Registro delle azioni amministrative (mai il contenuto dei voti).
CREATE TABLE IF NOT EXISTS admin_log (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  username TEXT NOT NULL,
  election_id INTEGER,
  action TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS elections (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  assembly_date TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER NOT NULL DEFAULT 300,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 1,
  max_prefs INTEGER NOT NULL DEFAULT 1,
  allow_write_in INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

-- Turni di voto: 1 = principale, 2+ = ballottaggi.
-- ballot_json è la fotografia della scheda al momento dell'apertura.
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'bozza',   -- bozza | aperta | chiusa
  slug TEXT UNIQUE,
  ballot_json TEXT,
  opened_at INTEGER,
  ends_at INTEGER,
  closed_at INTEGER,
  extended INTEGER NOT NULL DEFAULT 0,
  results_hidden INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (election_id, number)
);

-- Aventi diritto: servono solo per distribuire i codici.
-- Si possono cancellare dopo l'assemblea ("Cancella dati personali").
-- socio = codice socio dell'anagrafica (vuoto se aggiunto a mano).
CREATE TABLE IF NOT EXISTS voters (
  id INTEGER PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  socio TEXT NOT NULL DEFAULT '',
  nome TEXT NOT NULL,
  cognome TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL DEFAULT '',
  tipologia TEXT NOT NULL DEFAULT '',
  code_status TEXT NOT NULL DEFAULT 'nessuno'  -- nessuno | email | stampato | errore
);

-- Associati eleggibili, per la ricerca nella scheda: solo il nome mostrato
-- (nome e cognome, più l'anno di nascita in caso di omonimi).
CREATE TABLE IF NOT EXISTS eligibles (
  id INTEGER PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);

-- Codici di voto: solo l'hash. voter_id serve durante la distribuzione
-- (per poter revocare/rigenerare un codice) e viene azzerato alla chiusura del voto.
CREATE TABLE IF NOT EXISTS codes (
  id TEXT PRIMARY KEY,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  hash TEXT NOT NULL UNIQUE,
  voter_id INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- Utilizzo dei codici, uno stato per ogni turno. Nessun timestamp.
CREATE TABLE IF NOT EXISTS code_uses (
  code_id TEXT NOT NULL REFERENCES codes(id) ON DELETE CASCADE,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  nonce_hash TEXT NOT NULL,
  PRIMARY KEY (code_id, round_id)
) WITHOUT ROWID;

-- Schede: nessun collegamento ai codici, nessun timestamp, id casuale.
CREATE TABLE IF NOT EXISTS ballots (
  id TEXT PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  content TEXT NOT NULL
) WITHOUT ROWID;

-- Totali delle schede cartacee (piano B), inseriti a mano.
CREATE TABLE IF NOT EXISTS paper_results (
  round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  PRIMARY KEY (round_id, question_id)
);
`;

export function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = DELETE;');
  db.exec('PRAGMA secure_delete = ON;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Colonne aggiunte dopo la prima versione: per i database già esistenti.
const ADDED_COLUMNS = [['voters', 'socio', "TEXT NOT NULL DEFAULT ''"]];

function migrate(db) {
  for (const [table, column, def] of ADDED_COLUMNS) {
    const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
    if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

// Esegue fn dentro una transazione: tutto o niente.
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
