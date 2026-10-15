// Aventi diritto, eleggibili e distribuzione dei codici monouso.
import { tx } from '../db.js';
import { parseCsvObjects, rowsToObjects } from '../lib/csv.js';
import { readXlsxRows, XlsxError } from '../lib/xlsx.js';
import { parseDay, formatDay, formatDayShort, ageOn } from '../lib/dates.js';
import { generateCode, hashCode, randomId, formatCode } from '../lib/crypto.js';
import { UserError, getRounds, getElection, isEditable, logAction } from './elections.js';

const pick = (row, ...keys) => {
  for (const k of keys) if (row[k] !== undefined && row[k] !== '') return row[k];
  return '';
};
const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function fullName(v) {
  return `${v.nome} ${v.cognome}`.trim();
}

function canIssueCodes(db, electionId) {
  // I codici si possono emettere solo finché il primo turno non è chiuso:
  // dopo la chiusura il legame socio–codice viene cancellato e non si
  // potrebbe più revocare un codice vecchio.
  const r1 = getRounds(db, electionId)[0];
  return r1 && r1.status !== 'chiusa';
}

function assertCanIssue(db, electionId) {
  if (!canIssueCodes(db, electionId)) throw new UserError('Il primo turno è chiuso: non si possono più emettere codici');
}

export function listVoters(db, electionId) {
  return db.prepare('SELECT * FROM voters WHERE election_id = ? ORDER BY cognome COLLATE NOCASE, nome COLLATE NOCASE').all(Number(electionId));
}

export function listEligibles(db, electionId) {
  return db.prepare('SELECT name FROM eligibles WHERE election_id = ? ORDER BY name COLLATE NOCASE').all(Number(electionId)).map((r) => r.name);
}

export function hasCodes(db, electionId) {
  return !!db.prepare('SELECT 1 FROM codes WHERE election_id = ? LIMIT 1').get(Number(electionId));
}

// --- Import dall'anagrafica soci (export Excel o CSV della segreteria) ---
//
// Lo stesso formato serve due volte:
//  1. l'anagrafica completa, prima dell'assemblea  → eleggibili;
//  2. l'anagrafica filtrata sui presenti (in sala e su Meet), il giorno stesso → aventi diritto.
// Criteri, uguali per entrambi e valutati alla data dell'assemblea:
// stato «Attivo» (se la colonna c'è), maggiorenne, tessera non scaduta.

// Colonne indispensabili (intestazioni dopo la normalizzazione → nome nell'export).
const REQUIRED = { codice: 'Codice', nome: 'Nome', cognome: 'Cognome', data_nascita: 'Data Nascita', scad_tessera: 'Scad. Tessera' };

// Legge il file caricato dal pannello: { xlsx: base64 } oppure { csv: testo }.
export function readMembersFile({ xlsx, csv } = {}) {
  let rows;
  if (xlsx) {
    try {
      rows = rowsToObjects(readXlsxRows(Buffer.from(String(xlsx), 'base64')));
    } catch (err) {
      throw new UserError(err instanceof XlsxError ? err.message : 'Il file Excel non è leggibile');
    }
  } else rows = parseCsvObjects(csv);
  if (!rows.length) throw new UserError('Il file è vuoto o non è leggibile');
  const missing = Object.entries(REQUIRED)
    .filter(([k]) => !(k in rows[0]))
    .map(([, label]) => `«${label}»`);
  if (missing.length) throw new UserError(`Nel file mancano le colonne ${missing.join(', ')}: serve l'export dell'anagrafica soci`);
  return rows;
}

// Data dell'assemblea ("AAAA-MM-GG"): serve per maggiore età e scadenza delle tessere.
export function assemblyDay(db, electionId) {
  const day = parseDay(getElection(db, electionId).assembly_date);
  if (!day) throw new UserError('Imposta prima la data dell\'assemblea (sezione 1): serve per controllare maggiore età e tessere');
  return day;
}

// Applica i criteri e scarta i doppioni (stesso codice socio o stesso codice fiscale).
export function checkMembers(rows, day) {
  const ok = [];
  const excluded = [];
  const seenSocio = new Map();
  const seenCf = new Map();
  rows.forEach((row, i) => {
    const line = i + 2;
    const nome = clean(row.nome);
    const cognome = clean(row.cognome);
    const out = (reason) => excluded.push({ line, name: `${nome} ${cognome}`.trim() || '(senza nome)', reason });
    if (!nome || !cognome) return out('nome o cognome mancante');
    const socio = clean(row.codice);
    if (!socio) return out('codice socio mancante');
    const cf = clean(pick(row, 'cod_fiscale', 'codice_fiscale')).toUpperCase();
    if (seenSocio.has(socio)) return out(`doppione della riga ${seenSocio.get(socio)} (stesso codice socio)`);
    if (cf && seenCf.has(cf)) return out(`doppione della riga ${seenCf.get(cf)} (stesso codice fiscale)`);
    seenSocio.set(socio, line);
    if (cf) seenCf.set(cf, line);

    if ('stato' in row && clean(row.stato).toLowerCase() !== 'attivo') return out(`stato «${clean(row.stato) || 'vuoto'}»`);
    const birth = parseDay(row.data_nascita);
    if (!birth) return out('data di nascita mancante o non valida');
    if (ageOn(birth, day) < 18) return out('minorenne alla data dell\'assemblea');
    const expiry = parseDay(row.scad_tessera);
    if (!expiry) return out('tessera assente');
    if (expiry < day) return out(`tessera scaduta il ${formatDayShort(expiry)}`);

    const email = clean(pick(row, 'email', 'e_mail', 'mail')).toLowerCase();
    ok.push({ line, socio, nome, cognome, birth, email: EMAIL_RE.test(email) ? email : '', badEmail: email && !EMAIL_RE.test(email) ? email : '', gruppo: clean(row.gruppo) });
  });
  return { ok, excluded };
}

// Nome mostrato nella scheda. Per gli omonimi si aggiunge l'anno di nascita
// (o la data completa, o il codice socio, se ancora non basta).
function displayNames(members) {
  const base = (m) => `${m.nome} ${m.cognome}`;
  const groups = new Map();
  for (const m of members) {
    const k = base(m).toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const suffixes = [(m) => m.birth.slice(0, 4), (m) => formatDayShort(m.birth), (m) => `socio ${m.socio}`];
  const names = [];
  let homonyms = 0;
  for (const group of groups.values()) {
    if (group.length === 1) {
      names.push(base(group[0]));
      continue;
    }
    homonyms += group.length;
    for (const m of group) {
      const fmt = suffixes.find((f) => group.filter((o) => f(o) === f(m)).length === 1) ?? suffixes[2];
      names.push(`${base(m)} (${fmt(m)})`);
    }
  }
  return { names, homonyms };
}

/** Anagrafica completa → eleggibili (sostituisce l'elenco precedente, finché il voto non è aperto). */
export function importEligibles(db, electionId, file) {
  if (!isEditable(db, electionId)) throw new UserError('Il voto è già stato aperto: gli eleggibili non si possono più cambiare');
  const day = assemblyDay(db, electionId);
  const { ok, excluded } = checkMembers(readMembersFile(file), day);
  const { names, homonyms } = displayNames(ok);
  tx(db, () => {
    db.prepare('DELETE FROM eligibles WHERE election_id = ?').run(Number(electionId));
    const ins = db.prepare('INSERT INTO eligibles (election_id, name) VALUES (?, ?)');
    for (const n of names) ins.run(Number(electionId), n);
  });
  return { day: formatDay(day), eligibles: names.length, homonyms, excluded };
}

/**
 * Anagrafica dei presenti → aventi diritto. Si può ripetere con un file aggiornato
 * (es. chi arriva tardi): aggiunge solo i soci nuovi, chi c'è già resta con il suo codice.
 */
export function importVoters(db, electionId, file) {
  assertCanIssue(db, electionId);
  const day = assemblyDay(db, electionId);
  const { ok, excluded } = checkMembers(readMembersFile(file), day);
  const report = { day: formatDay(day), added: 0, already: 0, excluded, noEmail: [], badEmail: [] };
  tx(db, () => {
    const present = new Set(db.prepare('SELECT socio FROM voters WHERE election_id = ?').all(Number(electionId)).map((r) => r.socio));
    const ins = db.prepare('INSERT INTO voters (election_id, socio, nome, cognome, email, categoria, tipologia) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const m of ok) {
      if (present.has(m.socio)) {
        report.already++;
        continue;
      }
      ins.run(Number(electionId), m.socio, m.nome, m.cognome, m.email, m.gruppo.toLowerCase(), 'adulto');
      report.added++;
      if (m.badEmail) report.badEmail.push(`${m.nome} ${m.cognome} (${m.badEmail})`);
      else if (!m.email) report.noEmail.push(`${m.nome} ${m.cognome}`);
    }
  });
  return report;
}

// Aggiunta a mano (es. un socio presente che non compare nel file del giorno).
export function addVoter(db, electionId, { nome, cognome, email, categoria = '', tipologia = 'adulto' }) {
  assertCanIssue(db, electionId);
  const n = clean(nome);
  const c = clean(cognome);
  const e = clean(email).toLowerCase();
  if (!n || !c) throw new UserError('Nome e cognome sono obbligatori');
  if (e && !EMAIL_RE.test(e)) throw new UserError('Email non valida');
  db.prepare('INSERT INTO voters (election_id, nome, cognome, email, categoria, tipologia) VALUES (?, ?, ?, ?, ?, ?)').run(
    Number(electionId),
    n,
    c,
    e,
    clean(categoria).toLowerCase(),
    clean(tipologia).toLowerCase(),
  );
}

export function updateVoterEmail(db, electionId, voterId, email) {
  const e = clean(email).toLowerCase();
  if (e && !EMAIL_RE.test(e)) throw new UserError('Email non valida');
  db.prepare('UPDATE voters SET email = ? WHERE id = ? AND election_id = ?').run(e, Number(voterId), Number(electionId));
}

export function clearVoters(db, electionId) {
  const r1 = getRounds(db, electionId)[0];
  if (r1?.status !== 'bozza') throw new UserError('Il voto è già stato aperto: l\'elenco non si può più svuotare');
  tx(db, () => {
    db.prepare('DELETE FROM codes WHERE election_id = ?').run(Number(electionId));
    db.prepare('DELETE FROM voters WHERE election_id = ?').run(Number(electionId));
  });
}

// Cancella i dati personali dopo l'assemblea (restano risultati e registro).
export function deletePersonalData(db, electionId) {
  if (getRounds(db, electionId).some((r) => r.status === 'aperta')) throw new UserError('Il voto è ancora aperto');
  tx(db, () => {
    db.prepare('DELETE FROM voters WHERE election_id = ?').run(Number(electionId));
    db.prepare('DELETE FROM eligibles WHERE election_id = ?').run(Number(electionId));
    db.prepare('UPDATE codes SET voter_id = NULL WHERE election_id = ?').run(Number(electionId));
  });
}

/**
 * Emette un nuovo codice per un socio, revocando quelli eventualmente emessi prima.
 * Il codice in chiaro esiste solo in memoria: nel database finisce solo l'hash.
 */
function issueCode(db, cfg, electionId, voterId, { revokeOld = true } = {}) {
  const used = db
    .prepare('SELECT 1 FROM codes c JOIN code_uses u ON u.code_id = c.id WHERE c.election_id = ? AND c.voter_id = ? LIMIT 1')
    .get(Number(electionId), Number(voterId));
  if (used) throw new UserError('Il codice di questo socio è già stato usato per votare: non se ne può emettere un altro');

  if (revokeOld) db.prepare('UPDATE codes SET revoked = 1 WHERE election_id = ? AND voter_id = ?').run(Number(electionId), Number(voterId));
  let code;
  let hash;
  do {
    code = generateCode();
    hash = hashCode(cfg.codeSecret, electionId, code);
  } while (db.prepare('SELECT 1 FROM codes WHERE hash = ?').get(hash));
  const id = randomId();
  db.prepare('INSERT INTO codes (id, election_id, hash, voter_id) VALUES (?, ?, ?, ?)').run(id, Number(electionId), hash, Number(voterId));
  return { id, code };
}

function emailText(election, voter, code) {
  const forWhom =
    voter.tipologia === 'minore'
      ? `\nQuesto codice è per il voto di ${fullName(voter)} (associato minorenne), che rappresenti come genitore.\n`
      : '';
  return {
    subject: `Il tuo codice di voto — ${election.title}`,
    text: `Gentile associato,

ecco il codice monouso per votare a «${election.title}»${election.assembly_date ? ` (${formatDay(election.assembly_date)})` : ''}.
Codice per: ${fullName(voter)}
${forWhom}
    CODICE:  ${formatCode(code)}

Come votare:
1. All'apertura del voto, sullo schermo dell'assemblea (in sala e su Google Meet) compariranno un QR code e l'indirizzo della votazione.
2. Inquadra il QR code o scrivi l'indirizzo nel browser del telefono.
3. Inserisci questo codice ed esprimi il tuo voto.

Il codice vale una sola volta per ciascun turno e funziona solo mentre il voto è aperto.
In caso di ballottaggio si usa lo stesso codice.
Il voto è anonimo: il sistema registra che il codice è stato usato, ma non collega in alcun modo il codice alla scheda.

Non inoltrare questa email: chi ha il codice può votare al posto tuo.

Magnetico Associazione Culturale`,
  };
}

// Un solo invio alla volta per votazione: un doppio clic non deve generare due codici
// per lo stesso socio (il secondo revocherebbe il primo, già arrivato via email).
const sending = new Set();

/** Genera e invia via email i codici a chi non lo ha ancora ricevuto (o a chi è indicato). */
export async function sendCodesByEmail(db, cfg, mailer, electionId, opts = {}) {
  const key = Number(electionId);
  if (sending.has(key)) throw new UserError('Un invio di codici è già in corso per questa votazione: attendi che finisca.');
  sending.add(key);
  try {
    return await sendCodesByEmailUnlocked(db, cfg, mailer, electionId, opts);
  } finally {
    sending.delete(key);
  }
}

async function sendCodesByEmailUnlocked(db, cfg, mailer, electionId, { voterIds = null, username = 'sistema' } = {}) {
  assertCanIssue(db, electionId);
  const election = db.prepare('SELECT * FROM elections WHERE id = ?').get(Number(electionId));
  let voters = listVoters(db, electionId).filter((v) => v.email);
  voters = voterIds ? voters.filter((v) => voterIds.includes(v.id)) : voters.filter((v) => ['nessuno', 'errore'].includes(v.code_status));

  const result = { sent: 0, failed: [] };
  for (const v of voters) {
    // Prima dell'apertura il codice precedente resta valido finché il nuovo non è consegnato.
    // A voto aperto invece si revoca subito: due codici validi insieme permetterebbero di votare due volte.
    const roundOpen = !!db.prepare("SELECT 1 FROM rounds WHERE election_id = ? AND status = 'aperta'").get(Number(electionId));
    const oldIds = db
      .prepare('SELECT id FROM codes WHERE election_id = ? AND voter_id = ? AND revoked = 0')
      .all(Number(electionId), v.id)
      .map((r) => r.id);
    let issued;
    try {
      issued = tx(db, () => issueCode(db, cfg, electionId, v.id, { revokeOld: roundOpen }));
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      result.failed.push({ name: fullName(v), email: v.email, error: err.message });
      continue;
    }
    try {
      const { subject, text } = emailText(election, v, issued.code);
      await mailer.send({ to: v.email, subject, text });
      tx(db, () => {
        // Revoca per id (non per socio: alla chiusura del voto il legame socio–codice viene cancellato).
        const usedMeanwhile = oldIds.some((id) => db.prepare('SELECT 1 FROM code_uses WHERE code_id = ?').get(id));
        // Se nel frattempo il socio ha votato con il codice vecchio, il nuovo non deve valere.
        const revoke = usedMeanwhile ? [...oldIds, issued.id] : oldIds;
        for (const id of revoke) db.prepare('UPDATE codes SET revoked = 1 WHERE id = ?').run(id);
        db.prepare("UPDATE voters SET code_status = 'email' WHERE id = ?").run(v.id);
      });
      result.sent++;
    } catch (err) {
      // Invio fallito: il nuovo codice non è arrivato a nessuno, lo revochiamo; quello vecchio resta valido.
      db.prepare('UPDATE codes SET revoked = 1 WHERE id = ?').run(issued.id);
      const hasValid = oldIds.some((id) => db.prepare('SELECT 1 FROM codes WHERE id = ? AND revoked = 0').get(id));
      if (!hasValid) db.prepare("UPDATE voters SET code_status = 'errore' WHERE id = ?").run(v.id);
      result.failed.push({ name: fullName(v), email: v.email, error: err.message });
    }
  }
  logAction(db, username, electionId, `Codici inviati via email: ${result.sent}${result.failed.length ? `, errori: ${result.failed.length}` : ''}`);
  return result;
}

/** Genera i codici da stampare sui cartellini. Restituisce i codici in chiaro UNA sola volta. */
export function issuePrintedCodes(db, cfg, electionId, { voterIds = null, username = 'sistema' } = {}) {
  assertCanIssue(db, electionId);
  let voters = listVoters(db, electionId);
  voters = voterIds ? voters.filter((v) => voterIds.includes(v.id)) : voters.filter((v) => v.code_status === 'nessuno' && !v.email);
  const cards = tx(db, () =>
    voters.map((v) => {
      const { code } = issueCode(db, cfg, electionId, v.id);
      db.prepare("UPDATE voters SET code_status = 'stampato' WHERE id = ?").run(v.id);
      return { name: fullName(v), minore: v.tipologia === 'minore', code: formatCode(code) };
    }),
  );
  logAction(db, username, electionId, `Codici generati per la stampa: ${cards.length}`);
  return cards;
}

export function codeStats(db, electionId, roundId) {
  const emitted = db.prepare('SELECT COUNT(*) AS n FROM codes WHERE election_id = ? AND revoked = 0').get(Number(electionId)).n;
  const used = roundId ? db.prepare('SELECT COUNT(*) AS n FROM code_uses WHERE round_id = ?').get(Number(roundId)).n : 0;
  return { emitted, used, unused: emitted - used };
}
