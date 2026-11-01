// Votazioni, domande della scheda, candidati e turni (apertura, proroga, chiusura).
import { tx } from '../db.js';
import { generateSlug } from '../lib/crypto.js';
import { parseDay } from '../lib/dates.js';
import { tallyRound } from './tally.js';

export class UserError extends Error {}

export const EXTENSION_SEC = 120; // proroga massima: 2 minuti, una sola volta

export function listElections(db) {
  return db
    .prepare(
      `SELECT e.*, (SELECT status FROM rounds r WHERE r.election_id = e.id ORDER BY number DESC LIMIT 1) AS status
       FROM elections e ORDER BY e.id DESC`,
    )
    .all();
}

export function getElection(db, id) {
  const e = db.prepare('SELECT * FROM elections WHERE id = ?').get(Number(id));
  if (!e) throw new UserError('Votazione non trovata');
  return e;
}

export function createElection(db, { title, assemblyDate = '', durationMin = 5 }) {
  const t = String(title ?? '').trim();
  if (!t) throw new UserError('Il titolo è obbligatorio');
  return tx(db, () => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO elections (title, assembly_date, duration_sec, created_at) VALUES (?, ?, ?, ?)')
      .run(t, cleanDay(assemblyDate), durationToSec(durationMin), Date.now());
    db.prepare("INSERT INTO rounds (election_id, number, status) VALUES (?, 1, 'bozza')").run(lastInsertRowid);
    return Number(lastInsertRowid);
  });
}

// La data dell'assemblea si salva come "AAAA-MM-GG" (serve per i controlli sull'anagrafica).
function cleanDay(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const day = parseDay(text);
  if (!day) throw new UserError('Data dell\'assemblea non valida: usa il formato gg/mm/aaaa');
  return day;
}

function durationToSec(min) {
  const m = Number(String(min).replace(',', '.'));
  if (!Number.isFinite(m) || m < 1 || m > 60) throw new UserError('La durata deve essere tra 1 e 60 minuti');
  return Math.round(m * 60);
}

export function updateElection(db, id, { title, assemblyDate, durationMin }) {
  assertEditable(db, id);
  const t = String(title ?? '').trim();
  if (!t) throw new UserError('Il titolo è obbligatorio');
  db.prepare('UPDATE elections SET title = ?, assembly_date = ?, duration_sec = ? WHERE id = ?').run(
    t,
    cleanDay(assemblyDate),
    durationToSec(durationMin),
    Number(id),
  );
}

export function deleteElection(db, id) {
  if (getRounds(db, id).some((r) => r.status === 'aperta')) {
    throw new UserError('Non si può eliminare una votazione mentre il voto è aperto');
  }
  db.prepare('DELETE FROM elections WHERE id = ?').run(Number(id));
}

// --- Scheda: domande e candidati (modificabili solo prima dell'apertura) ---

export function isEditable(db, electionId) {
  const r1 = db.prepare('SELECT status FROM rounds WHERE election_id = ? AND number = 1').get(Number(electionId));
  return r1?.status === 'bozza';
}

function assertEditable(db, electionId) {
  if (!isEditable(db, electionId)) throw new UserError('La votazione è già stata aperta: la scheda non si può più modificare');
}

export function getQuestions(db, electionId) {
  const qs = db.prepare('SELECT * FROM questions WHERE election_id = ? ORDER BY position, id').all(Number(electionId));
  const cand = db.prepare('SELECT * FROM candidates WHERE question_id = ? ORDER BY name COLLATE NOCASE');
  return qs.map((q) => ({ ...q, candidates: cand.all(q.id) }));
}

// Quesito: si risponde Favorevole o Non favorevole (in quest'ordine, mai mescolate).
export const QUESITO_OPTIONS = ['Favorevole', 'Non favorevole'];

const cleanKind = (kind) => (kind === 'quesito' ? 'quesito' : 'elezione');

function cleanQuestion({ title, seats, maxPrefs, allowWriteIn, kind }) {
  const t = String(title ?? '').trim();
  if (cleanKind(kind) === 'quesito') {
    if (!t) throw new UserError('Il testo del quesito è obbligatorio');
    return { t, s: 1, m: 1, w: 0 };
  }
  const s = Number(seats);
  const m = Number(maxPrefs);
  if (!t) throw new UserError('Il titolo della domanda è obbligatorio');
  if (!Number.isInteger(s) || s < 1 || s > 20) throw new UserError('I posti da assegnare devono essere tra 1 e 20');
  if (!Number.isInteger(m) || m < 1 || m > 20) throw new UserError('Le preferenze devono essere tra 1 e 20');
  return { t, s, m, w: allowWriteIn ? 1 : 0 };
}

export function addQuestion(db, electionId, data) {
  assertEditable(db, electionId);
  const kind = cleanKind(data.kind);
  const { t, s, m, w } = cleanQuestion({ ...data, kind });
  return tx(db, () => {
    const pos = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM questions WHERE election_id = ?').get(Number(electionId)).p;
    const id = Number(
      db
        .prepare('INSERT INTO questions (election_id, position, title, seats, max_prefs, allow_write_in, kind) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(Number(electionId), pos, t, s, m, w, kind).lastInsertRowid,
    );
    if (kind === 'quesito') {
      const ins = db.prepare('INSERT INTO candidates (question_id, name) VALUES (?, ?)');
      for (const name of QUESITO_OPTIONS) ins.run(id, name);
    }
    return id;
  });
}

function questionElection(db, questionId) {
  const q = db.prepare('SELECT * FROM questions WHERE id = ?').get(Number(questionId));
  if (!q) throw new UserError('Domanda non trovata');
  return q;
}

export function updateQuestion(db, questionId, data) {
  const q = questionElection(db, questionId);
  assertEditable(db, q.election_id);
  // Il tipo non cambia: per passare da elezione a quesito si elimina e si ricrea la domanda.
  const { t, s, m, w } = cleanQuestion({ ...data, kind: q.kind });
  db.prepare('UPDATE questions SET title = ?, seats = ?, max_prefs = ?, allow_write_in = ? WHERE id = ?').run(t, s, m, w, q.id);
  return q.election_id;
}

export function deleteQuestion(db, questionId) {
  const q = questionElection(db, questionId);
  assertEditable(db, q.election_id);
  db.prepare('DELETE FROM questions WHERE id = ?').run(q.id);
  return q.election_id;
}

export function addCandidate(db, questionId, name) {
  const q = questionElection(db, questionId);
  assertEditable(db, q.election_id);
  if (q.kind === 'quesito') throw new UserError('Le risposte di un quesito sono fisse: Favorevole e Non favorevole');
  const n = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!n) throw new UserError('Il nome del candidato è obbligatorio');
  const dup = db.prepare('SELECT 1 FROM candidates WHERE question_id = ? AND name = ? COLLATE NOCASE').get(q.id, n);
  if (dup) throw new UserError(`${n} è già tra i candidati di questa domanda`);
  db.prepare('INSERT INTO candidates (question_id, name) VALUES (?, ?)').run(q.id, n);
  return q.election_id;
}

export function deleteCandidate(db, candidateId) {
  const c = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(candidateId));
  if (!c) throw new UserError('Candidato non trovato');
  const q = questionElection(db, c.question_id);
  assertEditable(db, q.election_id);
  if (q.kind === 'quesito') throw new UserError('Le risposte di un quesito sono fisse: Favorevole e Non favorevole');
  db.prepare('DELETE FROM candidates WHERE id = ?').run(c.id);
  return q.election_id;
}

// Fotografia della scheda: è ciò che vedono gli elettori e su cui si fa lo scrutinio.
export function buildBallot(db, electionId) {
  return {
    questions: getQuestions(db, electionId).map((q) => ({
      id: `q${q.id}`,
      kind: q.kind,
      title: q.title,
      seats: q.seats,
      maxPrefs: q.max_prefs,
      allowWriteIn: !!q.allow_write_in,
      candidates: (q.kind === 'quesito' ? QUESITO_OPTIONS.map((n) => q.candidates.find((c) => c.name === n)).filter(Boolean) : q.candidates).map(
        (c) => ({ id: `c${c.id}`, name: c.name }),
      ),
    })),
  };
}

// --- Turni ---

export function getRounds(db, electionId) {
  return db.prepare('SELECT * FROM rounds WHERE election_id = ? ORDER BY number').all(Number(electionId)).map(parseRound);
}

export function getRound(db, roundId) {
  const r = db.prepare('SELECT * FROM rounds WHERE id = ?').get(Number(roundId));
  if (!r) throw new UserError('Turno non trovato');
  return parseRound(r);
}

export function currentRound(db, electionId) {
  const r = db.prepare('SELECT * FROM rounds WHERE election_id = ? ORDER BY number DESC LIMIT 1').get(Number(electionId));
  return parseRound(r);
}

function parseRound(r) {
  if (!r) return r;
  return { ...r, ballot: r.ballot_json ? JSON.parse(r.ballot_json) : null };
}

export function roundLabel(r) {
  return r.number === 1 ? 'Primo turno' : r.number === 2 ? 'Ballottaggio' : `Ballottaggio n. ${r.number - 1}`;
}

export function openRound(db, electionId, now = Date.now()) {
  closeExpired(db, now);
  const election = getElection(db, electionId);
  return tx(db, () => {
    const round = currentRound(db, electionId);
    if (!round || round.status !== 'bozza') throw new UserError('Non c\'è nessun turno da aprire');
    const open = db.prepare("SELECT 1 FROM rounds WHERE status = 'aperta' AND election_id = ?").get(Number(electionId));
    if (open) throw new UserError('C\'è già un turno aperto');

    const ballot = round.number === 1 ? buildBallot(db, electionId) : round.ballot;
    validateBallotSetup(ballot);
    const codes = db.prepare('SELECT COUNT(*) AS n FROM codes WHERE election_id = ? AND revoked = 0').get(Number(electionId)).n;
    if (codes === 0) throw new UserError('Nessun codice distribuito: invia o stampa i codici prima di aprire il voto');

    let slug;
    do slug = generateSlug();
    while (db.prepare('SELECT 1 FROM rounds WHERE slug = ?').get(slug));

    db.prepare(
      "UPDATE rounds SET status = 'aperta', slug = ?, ballot_json = ?, opened_at = ?, ends_at = ?, results_hidden = 0 WHERE id = ?",
    ).run(slug, JSON.stringify(ballot), now, now + election.duration_sec * 1000, round.id);
    return getRound(db, round.id);
  });
}

function validateBallotSetup(ballot) {
  if (!ballot?.questions?.length) throw new UserError('La scheda è vuota: aggiungi almeno una domanda');
  for (const q of ballot.questions) {
    if (!q.candidates.length && !q.allowWriteIn) {
      throw new UserError(`La domanda «${q.title}» non ha candidati`);
    }
  }
}

export function extendRound(db, roundId, now = Date.now()) {
  closeExpired(db, now);
  tx(db, () => {
    const r = getRound(db, roundId);
    if (r.status !== 'aperta' || r.ends_at <= now) throw new UserError('Il voto non è aperto: la proroga va decisa prima dello scadere del tempo');
    if (r.extended) throw new UserError('La proroga è già stata usata per questo turno');
    db.prepare('UPDATE rounds SET ends_at = ends_at + ?, extended = 1 WHERE id = ?').run(EXTENSION_SEC * 1000, r.id);
  });
}

export function closeRound(db, roundId, now = Date.now()) {
  tx(db, () => {
    const r = getRound(db, roundId);
    if (r.status !== 'aperta') return;
    db.prepare("UPDATE rounds SET status = 'chiusa', closed_at = ?, ends_at = MIN(ends_at, ?) WHERE id = ?").run(now, now, r.id);
    // Da qui in poi non serve più sapere a quale socio era stato dato quale codice.
    db.prepare('UPDATE codes SET voter_id = NULL WHERE election_id = ?').run(r.election_id);
  });
}

// Chiude i turni scaduti. Chiamata ogni secondo dal server e a ogni richiesta rilevante.
export function closeExpired(db, now = Date.now()) {
  const expired = db.prepare("SELECT id FROM rounds WHERE status = 'aperta' AND ends_at <= ?").all(now);
  for (const r of expired) closeRound(db, r.id, now);
  return expired.length;
}

export function setResultsHidden(db, roundId, hidden) {
  db.prepare('UPDATE rounds SET results_hidden = ? WHERE id = ?').run(hidden ? 1 : 0, Number(roundId));
}

// Parità all'ultimo posto utile ancora da risolvere, in qualunque turno chiuso.
// (Se al primo turno ci sono parità su due domande, si fanno due ballottaggi, uno dopo l'altro.)
export function pendingTies(db, electionId) {
  const rounds = getRounds(db, electionId);
  const done = new Set(rounds.filter((r) => r.ballot?.runoffOf).map((r) => `${r.ballot.runoffOf.round}:${r.ballot.runoffOf.question}`));
  const out = [];
  for (const r of rounds) {
    if (r.status !== 'chiusa') continue;
    for (const q of tallyRound(db, r).questions) {
      if (q.tie && !done.has(`${r.number}:${q.id}`)) {
        out.push({ roundId: r.id, roundNumber: r.number, questionId: q.id, title: q.title, names: q.tie.names, seatsLeft: q.tie.seatsLeft });
      }
    }
  }
  return out;
}

// Crea il ballottaggio per una domanda con parità all'ultimo posto utile.
export function createRunoff(db, electionId, roundId, questionId) {
  return tx(db, () => {
    const last = currentRound(db, electionId);
    if (last.status !== 'chiusa') throw new UserError('C\'è già un turno in preparazione o aperto: chiudilo prima di preparare un altro ballottaggio');
    const tie = pendingTies(db, electionId).find((t) => t.roundId === Number(roundId) && t.questionId === questionId);
    if (!tie) throw new UserError('Per questa domanda non c\'è una parità da risolvere');
    const number = last.number + 1;
    const ballot = {
      runoffOf: { round: tie.roundNumber, question: tie.questionId },
      questions: [
        {
          id: `${tie.questionId}-b${number}`,
          title: `${tie.title.replace(/ — ballottaggio$/, '')} — ballottaggio`,
          seats: tie.seatsLeft,
          maxPrefs: 1,
          allowWriteIn: false,
          candidates: tie.names.map((name, i) => ({ id: `b${i + 1}`, name })),
        },
      ],
    };
    const note = `${ballot.questions[0].title}: ${tie.seatsLeft === 1 ? '1 posto' : `${tie.seatsLeft} posti`} tra ${tie.names.join(', ')}`;
    const { lastInsertRowid } = db
      .prepare("INSERT INTO rounds (election_id, number, status, ballot_json, note) VALUES (?, ?, 'bozza', ?, ?)")
      .run(Number(electionId), number, JSON.stringify(ballot), note);
    return Number(lastInsertRowid);
  });
}

export function logAction(db, username, electionId, action) {
  db.prepare('INSERT INTO admin_log (at, username, election_id, action) VALUES (?, ?, ?, ?)').run(
    Date.now(),
    username,
    electionId ?? null,
    action,
  );
}

export function getLog(db, electionId) {
  return db.prepare('SELECT * FROM admin_log WHERE election_id = ? ORDER BY id').all(Number(electionId));
}
