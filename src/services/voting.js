// Il voto: verifica del codice, validazione della scheda, registrazione atomica.
import { tx } from '../db.js';
import { hashCode, normalizeCode, isWellFormedCode, randomId, sha256 } from '../lib/crypto.js';
import { closeExpired } from './elections.js';

export class VoteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const MESSAGES = {
  closed: 'La votazione non è aperta in questo momento.',
  malformed: 'Il codice non è scritto correttamente: controlla di aver copiato tutti i 12 caratteri.',
  invalid: 'Codice non valido. Controlla di averlo scritto bene.',
  used: 'Questo codice è già stato usato per votare in questo turno.',
  ballot: 'La scheda non è valida.',
};

export function getOpenRoundBySlug(db, slug, now = Date.now()) {
  closeExpired(db, now);
  const r = db.prepare('SELECT * FROM rounds WHERE slug = ?').get(String(slug ?? ''));
  if (!r) return null;
  return { ...r, ballot: r.ballot_json ? JSON.parse(r.ballot_json) : null };
}

function assertOpen(round, now) {
  if (!round || round.status !== 'aperta' || now >= round.ends_at) throw new VoteError('closed', MESSAGES.closed);
}

function findCode(db, cfg, round, rawCode) {
  const code = normalizeCode(rawCode);
  if (!isWellFormedCode(code)) throw new VoteError('malformed', MESSAGES.malformed);
  const row = db
    .prepare('SELECT id FROM codes WHERE hash = ? AND election_id = ? AND revoked = 0')
    .get(hashCode(cfg.codeSecret, round.election_id, code), round.election_id);
  if (!row) throw new VoteError('invalid', MESSAGES.invalid);
  return row.id;
}

/** Controlla il codice prima di mostrare la scheda (non lo consuma). */
export function checkCode(db, cfg, round, rawCode, now = Date.now()) {
  assertOpen(round, now);
  const codeId = findCode(db, cfg, round, rawCode);
  const used = db.prepare('SELECT 1 FROM code_uses WHERE code_id = ? AND round_id = ?').get(codeId, round.id);
  if (used) throw new VoteError('used', MESSAGES.used);
  return true;
}

/** Ricerca di altri associati eleggibili (solo nome e cognome). Serve un codice valido. */
export function searchEligibles(db, cfg, round, rawCode, questionId, query, now = Date.now()) {
  checkCode(db, cfg, round, rawCode, now);
  const q = round.ballot.questions.find((x) => x.id === questionId);
  if (!q?.allowWriteIn) return [];
  const term = String(query ?? '').trim().toLowerCase();
  if (term.length < 2) return [];
  const listed = new Set(q.candidates.map((c) => c.name.toLowerCase()));
  const words = term.split(/\s+/);
  return db
    .prepare('SELECT name FROM eligibles WHERE election_id = ? ORDER BY name COLLATE NOCASE')
    .all(round.election_id)
    .map((r) => r.name)
    .filter((n) => !listed.has(n.toLowerCase()) && words.every((w) => n.toLowerCase().includes(w)))
    .slice(0, 8);
}

/**
 * Normalizza e valida la scheda inviata dal telefono.
 * Input:  { abstain: true }  oppure  { answers: { q12: { picks: [{id:'c3'} | {name:'Mario Rossi'}] } } }
 * Output: { a: 1 }           oppure  { q: { q12: ['c3', 'n:Mario Rossi'] } }   (lista vuota = scheda bianca)
 */
export function validateBallot(db, round, content) {
  const bad = (msg) => new VoteError('ballot', msg ?? MESSAGES.ballot);
  if (!content || typeof content !== 'object') throw bad();
  if (content.abstain === true) return { a: 1 };

  const answers = content.answers ?? {};
  if (typeof answers !== 'object') throw bad();
  const eligible = new Map(
    db
      .prepare('SELECT name FROM eligibles WHERE election_id = ?')
      .all(round.election_id)
      .map((r) => [r.name.toLowerCase(), r.name]),
  );

  const out = {};
  for (const q of round.ballot.questions) {
    const a = answers[q.id] ?? { picks: [] };
    const picks = Array.isArray(a.picks) ? a.picks : [];
    if (picks.length > q.maxPrefs) throw bad(`«${q.title}»: puoi indicare al massimo ${q.maxPrefs} ${q.maxPrefs === 1 ? 'nome' : 'nomi'}.`);
    const byName = new Map(q.candidates.map((c) => [c.name.toLowerCase(), c.id]));
    const ids = new Set(q.candidates.map((c) => c.id));
    const chosen = [];
    for (const p of picks) {
      let key;
      if (p && typeof p.id === 'string' && ids.has(p.id)) key = p.id;
      else if (p && typeof p.name === 'string') {
        const lower = p.name.trim().toLowerCase();
        if (byName.has(lower)) key = byName.get(lower); // nome già in lista
        else if (q.allowWriteIn && eligible.has(lower)) key = `n:${eligible.get(lower)}`;
        else throw bad(`«${p.name}» non risulta tra gli associati eleggibili.`);
      } else throw bad();
      if (chosen.includes(key)) throw bad('La stessa persona non può comparire due volte nella stessa scheda.');
      chosen.push(key);
    }
    out[q.id] = chosen;
  }
  for (const k of Object.keys(answers)) if (!round.ballot.questions.some((q) => q.id === k)) throw bad();
  return { q: out };
}

/**
 * Registra il voto. In un'unica transazione:
 *  1) marca il codice come usato per questo turno;
 *  2) salva la scheda in una tabella separata, con id casuale e senza alcun riferimento al codice.
 * Il "nonce" generato dal telefono permette di riconoscere un reinvio dopo una perdita di rete:
 * se la stessa richiesta arriva due volte, la seconda risponde "già registrato" senza votare di nuovo.
 */
export function castVote(db, cfg, round, { code: rawCode, content, nonce }, now = Date.now()) {
  assertOpen(round, now);
  const codeId = findCode(db, cfg, round, rawCode);
  const ballot = validateBallot(db, round, content);
  const nonceHash = sha256(`${codeId}:${String(nonce ?? '')}`);

  return tx(db, () => {
    const fresh = db.prepare("SELECT status, ends_at FROM rounds WHERE id = ?").get(round.id);
    if (fresh.status !== 'aperta' || now >= fresh.ends_at) throw new VoteError('closed', MESSAGES.closed);

    const prior = db.prepare('SELECT nonce_hash FROM code_uses WHERE code_id = ? AND round_id = ?').get(codeId, round.id);
    if (prior) {
      if (nonce && prior.nonce_hash === nonceHash) return { ok: true, duplicate: true };
      throw new VoteError('used', MESSAGES.used);
    }
    db.prepare('INSERT INTO code_uses (code_id, round_id, nonce_hash) VALUES (?, ?, ?)').run(codeId, round.id, nonceHash);
    db.prepare('INSERT INTO ballots (id, round_id, content) VALUES (?, ?, ?)').run(randomId(), round.id, JSON.stringify(ballot));
    return { ok: true, duplicate: false };
  });
}
