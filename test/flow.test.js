// Prova completa: preparazione, distribuzione codici, voto, scrutinio, ballottaggio,
// più i casi limite richiesti dalle specifiche.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, login, adminPost, codesFrom, CSV } from './helpers.js';
import * as E from '../src/services/elections.js';

async function prepare({ seats = 3, maxPrefs = 3, writeIn = true, candidates = ['Giulia Bianchi', 'Marco Russo', 'Francesca Ferrari', 'Luca Esposito'] } = {}) {
  const t = await setup();
  const auth = await login(t.app);
  let r = await adminPost(t.app, auth, '/admin/votazioni', { title: 'Assemblea di test', assemblyDate: '2026-10-31', durationMin: '5' });
  assert.equal(r.statusCode, 200, r.body);
  const eid = 1;
  r = await adminPost(t.app, auth, `/admin/v/${eid}/domande`, { title: 'Consiglio Direttivo', seats: String(seats), maxPrefs: String(maxPrefs), allowWriteIn: writeIn ? '1' : '' });
  assert.equal(r.statusCode, 200, r.body);
  const qid = t.db.prepare('SELECT id FROM questions').get().id;
  for (const name of candidates) await adminPost(t.app, auth, `/admin/domande/${qid}/candidati`, { name });
  r = await adminPost(t.app, auth, `/admin/v/${eid}/eleggibili`, { csv: CSV });
  assert.equal(r.statusCode, 200, r.body);
  r = await adminPost(t.app, auth, `/admin/v/${eid}/presenti`, { csv: CSV });
  assert.equal(r.statusCode, 200, r.body);
  r = await adminPost(t.app, auth, `/admin/v/${eid}/codici/email`);
  assert.equal(r.statusCode, 200, r.body);
  return { ...t, auth, eid, qid, codes: codesFrom(t.outbox) };
}

async function open(t) {
  const r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/apri`);
  assert.equal(r.statusCode, 200, r.body);
  return E.currentRound(t.db, t.eid);
}

const vote = (t, slug, code, content, nonce = Math.random().toString(36)) =>
  t.app.inject({ method: 'POST', url: `/api/v/${slug}/vota`, payload: { code, content, nonce } });

const pick = (round, ...names) => {
  const q = round.ballot.questions[0];
  return { answers: { [q.id]: { picks: names.map((n) => { const c = q.candidates.find((x) => x.name === n); return c ? { id: c.id } : { name: n }; }) } } };
};

test('import: criteri alla data dell\'assemblea, doppioni, stessa email', async () => {
  const t = await prepare();
  // 8 aventi diritto su 13 righe: esclusi Conti (17 anni), Greco (tessera scaduta il giorno prima),
  // Costa (sospeso), il doppione di Bianchi (stesso codice fiscale), Verdi (senza tessera).
  // Russo (tessera che scade il giorno stesso) e Neri (18 anni compiuti il giorno stesso) votano.
  const voters = t.db.prepare('SELECT nome, cognome FROM voters ORDER BY cognome').all().map((r) => `${r.nome} ${r.cognome}`);
  assert.deepEqual(voters, ['Giulia Bianchi', 'Anna De Luca', 'Luca Esposito', 'Francesca Ferrari', 'Martina Gallo', 'Paolo Neri', 'Chiara Romano', 'Marco Russo']);
  const eligibles = t.db.prepare('SELECT name FROM eligibles ORDER BY name').all().map((r) => r.name);
  assert.deepEqual(eligibles, ['Anna De Luca', 'Chiara Romano', 'Francesca Ferrari', 'Giulia Bianchi', 'Luca Esposito', 'Marco Russo', 'Martina Gallo', 'Paolo Neri']);
  // due soci con la stessa email ricevono 2 email con 2 codici distinti
  const toM = t.outbox.filter((m) => m.to === 'm@example.test');
  assert.equal(toM.length, 2);
  assert.notEqual(codesFrom(toM)[0], codesFrom(toM)[1]);
  // nessun codice in chiaro nel database
  for (const c of t.codes) {
    const plain = c.replace(/-/g, '');
    const dump = JSON.stringify(t.db.prepare('SELECT * FROM codes').all());
    assert.ok(!dump.includes(plain));
  }
  await t.cleanup();
});

test('import dei presenti: ripetibile, aggiunge solo i nuovi', async () => {
  const t = await prepare();
  const header = CSV.split('\n')[0];
  const row = (n) => CSV.split('\n').find((l) => l.startsWith(`${n};`));
  // file aggiornato: due già presenti + un ritardatario (Verdi, ora con tessera ed email)
  const later = [header, row(1), row(3), '13;Verdi;Luisa;05/05/1990;CF13;v@example.test;SOCI;31/12/2026;Attivo'].join('\n');
  const r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/presenti`, { csv: later });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().added, 1);
  assert.equal(r.json().already, 2);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM voters').get().n, 9);
  // i codici già inviati restano validi; l'invio successivo va solo al nuovo
  const before = t.outbox.length;
  await adminPost(t.app, t.auth, `/admin/v/${t.eid}/codici/email`);
  assert.deepEqual(t.outbox.slice(before).map((m) => m.to), ['v@example.test']);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM codes WHERE revoked = 0').get().n, 9);
  await t.cleanup();
});

test('import: omonimi distinti, file senza colonne giuste, data mancante', async () => {
  const t = await setup();
  const auth = await login(t.app);
  await adminPost(t.app, auth, '/admin/votazioni', { title: 'Senza data', durationMin: '5' });
  let r = await adminPost(t.app, auth, '/admin/v/1/eleggibili', { csv: CSV });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /data dell'assemblea/);
  await adminPost(t.app, auth, '/admin/v/1/impostazioni', { title: 'Con data', assemblyDate: '31/10/2026', durationMin: '5' });
  r = await adminPost(t.app, auth, '/admin/v/1/eleggibili', { csv: 'nome;cognome\nA;B' });
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /Codice/);
  const csv = `Codice;Cognome;Nome;Data Nascita;Scad. Tessera
1;Rossi;Mario;01/06/1970;31/12/2026
2;Rossi;Mario;22/02/1992;31/12/2026
3;Rossi;Mario;22/02/1992;31/12/2026
4;Neri;Ada;01/01/1980;31/12/2026`;
  r = await adminPost(t.app, auth, '/admin/v/1/eleggibili', { csv });
  assert.equal(r.statusCode, 200, r.body);
  const eligibles = t.db.prepare('SELECT name FROM eligibles ORDER BY name').all().map((x) => x.name);
  // l'anno di nascita basta per il primo; gli altri due sono nati lo stesso giorno
  assert.deepEqual(eligibles, ['Ada Neri', 'Mario Rossi (1970)', 'Mario Rossi (socio 2)', 'Mario Rossi (socio 3)']);
  await t.cleanup();
});

test('voto completo, codice già usato, codice sbagliato, scrutinio e riconciliazione', async () => {
  const t = await prepare();
  const round = await open(t);
  const slug = round.slug;

  // pagina e info
  const info = await t.app.inject({ url: `/api/v/${slug}` });
  assert.equal(info.json().status, 'aperta');

  // codice sbagliato e malformato
  let r = await t.app.inject({ method: 'POST', url: `/api/v/${slug}/codice`, payload: { code: 'ABCD-EFGH-JKMN' } });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().code, 'invalid');
  r = await t.app.inject({ method: 'POST', url: `/api/v/${slug}/codice`, payload: { code: '123' } });
  assert.equal(r.json().code, 'malformed');

  // codice valido (in minuscolo e senza trattini va bene lo stesso)
  r = await t.app.inject({ method: 'POST', url: `/api/v/${slug}/codice`, payload: { code: t.codes[0].toLowerCase().replace(/-/g, '') } });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().ballot.questions[0].candidates.length, 4);

  // voti
  assert.equal((await vote(t, slug, t.codes[0], pick(round, 'Giulia Bianchi', 'Marco Russo', 'Francesca Ferrari'))).statusCode, 200);
  assert.equal((await vote(t, slug, t.codes[1], pick(round, 'Giulia Bianchi', 'Marco Russo'))).statusCode, 200);
  assert.equal((await vote(t, slug, t.codes[2], pick(round, 'Giulia Bianchi', 'Chiara Romano'))).statusCode, 200); // fuori lista, eleggibile
  assert.equal((await vote(t, slug, t.codes[3], pick(round))).statusCode, 200); // scheda bianca
  assert.equal((await vote(t, slug, t.codes[4], { abstain: true })).statusCode, 200); // astensione

  // codice già usato
  r = await vote(t, slug, t.codes[0], pick(round, 'Luca Esposito'));
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().code, 'used');

  // scheda non valida: troppi nomi, doppioni, non eleggibile, minorenne
  r = await vote(t, slug, t.codes[5], pick(round, 'Giulia Bianchi', 'Marco Russo', 'Francesca Ferrari', 'Luca Esposito'));
  assert.equal(r.statusCode, 422);
  r = await vote(t, slug, t.codes[5], pick(round, 'Giulia Bianchi', 'Giulia Bianchi'));
  assert.equal(r.statusCode, 422);
  r = await vote(t, slug, t.codes[5], pick(round, 'Elena Greco'));
  assert.equal(r.statusCode, 422);
  r = await vote(t, slug, t.codes[5], pick(round, 'Tommaso Conti'));
  assert.equal(r.statusCode, 422);
  // un nome in lista scritto a mano conta come il candidato in lista (niente doppio conteggio)
  r = await vote(t, slug, t.codes[5], { answers: { [round.ballot.questions[0].id]: { picks: [{ name: 'giulia bianchi' }] } } });
  assert.equal(r.statusCode, 200);

  // ricerca eleggibili: esclude i candidati in lista e chi non è eleggibile
  r = await t.app.inject({ method: 'POST', url: `/api/v/${slug}/cerca`, payload: { code: t.codes[6], question: round.ballot.questions[0].id, q: 'ro' } });
  assert.deepEqual(r.json().results, ['Chiara Romano']);

  // stato in tempo reale: niente risultati mentre il voto è aperto
  let s = await t.app.inject({ url: `/admin/api/v/${t.eid}/stato`, cookies: { sid: t.auth.sid } });
  assert.equal(s.json().stats.used, 6);
  assert.equal(s.json().results, undefined);
  assert.ok(s.json().qrSvg.startsWith('<svg'));

  // chiusura e risultati
  await adminPost(t.app, t.auth, `/admin/v/${t.eid}/chiudi`);
  s = (await t.app.inject({ url: `/admin/api/v/${t.eid}/stato`, cookies: { sid: t.auth.sid } })).json();
  const q = s.results.questions[0];
  const votes = Object.fromEntries(q.ranking.map((x) => [x.name, x.total]));
  assert.equal(votes['Giulia Bianchi'], 4);
  assert.equal(votes['Marco Russo'], 2);
  assert.equal(votes['Francesca Ferrari'], 1);
  assert.equal(votes['Chiara Romano'], 1);
  assert.equal(votes['Luca Esposito'], 0);
  assert.equal(q.blank, 1);
  assert.equal(s.results.abstained, 1);
  assert.equal(s.results.totalBallots, 6);
  assert.equal(s.results.usedCodes, 6);
  assert.equal(s.results.reconciled, true);
  // parità al terzo posto tra Ferrari e Romano (1 voto ciascuno)
  assert.deepEqual(q.elected, ['Giulia Bianchi', 'Marco Russo']);
  assert.deepEqual(q.tie.names.sort(), ['Chiara Romano', 'Francesca Ferrari']);
  assert.equal(q.tie.seatsLeft, 1);

  // a voto chiuso il codice non funziona più
  r = await vote(t, slug, t.codes[6], pick(round, 'Marco Russo'));
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().code, 'closed');

  // il legame socio–codice è stato cancellato
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM codes WHERE voter_id IS NOT NULL').get().n, 0);

  // CSV e pagina risultati
  const csv = await t.app.inject({ url: `/admin/v/${t.eid}/risultati.csv`, cookies: { sid: t.auth.sid } });
  assert.match(csv.body, /Giulia Bianchi;4;0;4;Eletto\/a/);
  const page = await t.app.inject({ url: `/admin/v/${t.eid}/risultati`, cookies: { sid: t.auth.sid } });
  assert.equal(page.statusCode, 200);

  // --- ballottaggio con gli stessi codici ---
  r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/ballottaggio`, { round: String(round.id), question: q.id });
  assert.equal(r.statusCode, 200, r.body);
  const r2 = await open(t);
  assert.equal(r2.number, 2);
  assert.notEqual(r2.slug, slug, 'nuovo indirizzo per il ballottaggio');
  const rq = r2.ballot.questions[0];
  assert.equal(rq.maxPrefs, 1);
  assert.equal(rq.seats, 1);
  const ferrari = rq.candidates.find((c) => c.name === 'Francesca Ferrari').id;
  const romano = rq.candidates.find((c) => c.name === 'Chiara Romano').id;
  // lo stesso codice del primo turno vale anche qui, una volta
  assert.equal((await vote(t, r2.slug, t.codes[0], { answers: { [rq.id]: { picks: [{ id: ferrari }] } } })).statusCode, 200);
  assert.equal((await vote(t, r2.slug, t.codes[0], { answers: { [rq.id]: { picks: [{ id: romano }] } } })).statusCode, 409);
  assert.equal((await vote(t, r2.slug, t.codes[1], { answers: { [rq.id]: { picks: [{ id: ferrari }] } } })).statusCode, 200);
  // nel ballottaggio una sola preferenza
  assert.equal((await vote(t, r2.slug, t.codes[2], { answers: { [rq.id]: { picks: [{ id: ferrari }, { id: romano }] } } })).statusCode, 422);
  assert.equal((await vote(t, r2.slug, t.codes[2], { answers: { [rq.id]: { picks: [{ id: romano }] } } })).statusCode, 200);
  // nel ballottaggio non si possono votare altri nomi
  assert.equal((await vote(t, r2.slug, t.codes[3], { answers: { [rq.id]: { picks: [{ name: 'Luca Esposito' }] } } })).statusCode, 422);
  // il vecchio indirizzo del primo turno non accetta voti
  assert.equal((await vote(t, slug, t.codes[7], pick(round, 'Marco Russo'))).json().code, 'closed');

  await adminPost(t.app, t.auth, `/admin/v/${t.eid}/chiudi`);
  s = (await t.app.inject({ url: `/admin/api/v/${t.eid}/stato`, cookies: { sid: t.auth.sid } })).json();
  assert.deepEqual(s.results.questions[0].elected, ['Francesca Ferrari']);
  assert.equal(s.results.reconciled, true);
  await t.cleanup();
});

test('rete persa: il reinvio della stessa scheda viene solo confermato', async () => {
  const t = await prepare();
  const round = await open(t);
  const ballot = pick(round, 'Marco Russo');
  let r = await vote(t, round.slug, t.codes[0], ballot, 'nonce-1');
  assert.equal(r.json().duplicate, false);
  r = await vote(t, round.slug, t.codes[0], ballot, 'nonce-1');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().duplicate, true);
  // con un altro nonce è un secondo tentativo di voto: rifiutato
  r = await vote(t, round.slug, t.codes[0], ballot, 'nonce-2');
  assert.equal(r.statusCode, 409);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM ballots').get().n, 1);
  await t.cleanup();
});

test('finestra temporale: chiusura automatica e proroga una sola volta', async () => {
  const t = await prepare();
  const round = await open(t);
  assert.equal(round.ends_at - round.opened_at, 5 * 60_000);
  let r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/proroga`);
  assert.equal(r.statusCode, 200);
  r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/proroga`);
  assert.equal(r.statusCode, 400);
  const extended = E.getRound(t.db, round.id);
  assert.equal(extended.ends_at - extended.opened_at, 7 * 60_000);
  // simula il passare del tempo
  E.closeExpired(t.db, extended.ends_at + 1);
  assert.equal(E.getRound(t.db, round.id).status, 'chiusa');
  await t.cleanup();
});

test('nessun collegamento tra schede e codici', async () => {
  const t = await prepare();
  const round = await open(t);
  for (let i = 0; i < 5; i++) await vote(t, round.slug, t.codes[i], pick(round, 'Marco Russo'));
  const cols = t.db.prepare("SELECT name FROM pragma_table_info('ballots')").all().map((c) => c.name);
  assert.deepEqual(cols.sort(), ['content', 'id', 'round_id']);
  const useCols = t.db.prepare("SELECT name FROM pragma_table_info('code_uses')").all().map((c) => c.name);
  assert.ok(!useCols.some((c) => /ballot|time|at$/.test(c)));
  // l'ordine fisico delle schede segue l'id casuale, non l'ordine di arrivo
  const ids = t.db.prepare('SELECT id FROM ballots').all().map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort());
  await t.cleanup();
});

test('codici: rigenerazione revoca il precedente, non si rigenera dopo il voto', async () => {
  const t = await prepare();
  const voter = t.db.prepare("SELECT id FROM voters WHERE email = 'g@example.test'").get();
  const before = t.outbox.length;
  let r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/soci/${voter.id}/reinvia`);
  assert.equal(r.statusCode, 200);
  const [oldCode] = codesFrom(t.outbox.slice(0, before).filter((m) => m.to === 'g@example.test'));
  const [newCode] = codesFrom(t.outbox.slice(before));
  const round = await open(t);
  r = await vote(t, round.slug, oldCode, pick(round, 'Marco Russo'));
  assert.equal(r.json().code, 'invalid');
  r = await vote(t, round.slug, newCode, pick(round, 'Marco Russo'));
  assert.equal(r.statusCode, 200);
  r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/soci/${voter.id}/reinvia`);
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /già stato usato/);
  await t.cleanup();
});

test('la scheda non si modifica dopo l\'apertura; non si apre senza codici', async () => {
  const t = await setup();
  const auth = await login(t.app);
  await adminPost(t.app, auth, '/admin/votazioni', { title: 'X', assemblyDate: '2026-10-31', durationMin: '5' });
  await adminPost(t.app, auth, '/admin/v/1/domande', { title: 'Presidente', seats: '1', maxPrefs: '1' });
  const qid = t.db.prepare('SELECT id FROM questions').get().id;
  await adminPost(t.app, auth, `/admin/domande/${qid}/candidati`, { name: 'Anna Verdi' });
  let r = await adminPost(t.app, auth, '/admin/v/1/apri');
  assert.equal(r.statusCode, 400);
  assert.match(r.json().error, /Nessun codice/);
  await adminPost(t.app, auth, '/admin/v/1/presenti', { csv: CSV });
  await adminPost(t.app, auth, '/admin/v/1/codici/email');
  r = await adminPost(t.app, auth, '/admin/v/1/apri');
  assert.equal(r.statusCode, 200);
  r = await adminPost(t.app, auth, `/admin/domande/${qid}/candidati`, { name: 'Altro Nome' });
  assert.equal(r.statusCode, 400);
  await t.cleanup();
});

test('schede cartacee: sommate ma su righe separate', async () => {
  const t = await prepare();
  const round = await open(t);
  await vote(t, round.slug, t.codes[0], pick(round, 'Marco Russo'));
  await adminPost(t.app, t.auth, `/admin/v/${t.eid}/chiudi`);
  const qid = round.ballot.questions[0].id;
  const r = await adminPost(t.app, t.auth, `/admin/v/${t.eid}/turni/${round.id}/cartacee`, {
    question: qid,
    'v:Marco Russo': '2',
    'v:Giulia Bianchi': '1',
    others: 'Mario Neri; 3',
    bianche: '1',
    nulle: '1',
    schede: '5',
  });
  assert.equal(r.statusCode, 200, r.body);
  const s = (await t.app.inject({ url: `/admin/api/v/${t.eid}/stato`, cookies: { sid: t.auth.sid } })).json();
  const marco = s.results.questions[0].ranking.find((x) => x.name === 'Marco Russo');
  assert.deepEqual([marco.online, marco.paper, marco.total], [1, 2, 3]);
  assert.equal(s.results.questions[0].ranking.find((x) => x.name === 'Mario Neri').paper, 3);
  await t.cleanup();
});

test('accesso: senza login niente pannello, niente API', async () => {
  const t = await setup();
  let r = await t.app.inject({ url: '/admin' });
  assert.equal(r.statusCode, 303);
  r = await t.app.inject({ url: '/admin/api/v/1/stato' });
  assert.equal(r.statusCode, 401);
  r = await t.app.inject({ method: 'POST', url: '/admin/login', payload: { username: 'admin', password: 'sbagliata' } });
  assert.equal(r.statusCode, 401);
  // richiesta POST da un altro sito
  r = await t.app.inject({ method: 'POST', url: '/admin/login', headers: { origin: 'https://attacco.example', host: 'localhost' }, payload: { username: 'admin', password: 'pw' } });
  assert.equal(r.statusCode, 403);
  await t.cleanup();
});

test('carico: 100 voti in parallelo, riconciliazione esatta', async () => {
  const t = await setup();
  const auth = await login(t.app);
  await adminPost(t.app, auth, '/admin/votazioni', { title: 'Carico', assemblyDate: '2026-10-31', durationMin: '5' });
  await adminPost(t.app, auth, '/admin/v/1/domande', { title: 'CD', seats: '3', maxPrefs: '3' });
  const qid = t.db.prepare('SELECT id FROM questions').get().id;
  for (const n of ['A A', 'B B', 'C C', 'D D', 'E E']) await adminPost(t.app, auth, `/admin/domande/${qid}/candidati`, { name: n });
  const rows = ['Codice;Nome;Cognome;Email;Data Nascita;Scad. Tessera'];
  for (let i = 0; i < 100; i++) rows.push(`${i};N${i};C${i};u${i}@example.test;01/01/1990;31/12/2026`);
  await adminPost(t.app, auth, '/admin/v/1/presenti', { csv: rows.join('\n') });
  await adminPost(t.app, auth, '/admin/v/1/codici/email');
  const codes = codesFrom(t.outbox);
  assert.equal(codes.length, 100);
  await adminPost(t.app, auth, '/admin/v/1/apri');
  const round = E.currentRound(t.db, 1);
  const q = round.ballot.questions[0];
  const started = Date.now();
  const res = await Promise.all(
    codes.map((code, i) => vote({ app: t.app }, round.slug, code, { answers: { [q.id]: { picks: [{ id: q.candidates[i % 5].id }] } } })),
  );
  const elapsed = Date.now() - started;
  assert.ok(res.every((r) => r.statusCode === 200));
  await adminPost(t.app, auth, '/admin/v/1/chiudi');
  const s = (await t.app.inject({ url: '/admin/api/v/1/stato', cookies: { sid: auth.sid } })).json();
  assert.equal(s.results.totalBallots, 100);
  assert.equal(s.results.reconciled, true);
  assert.ok(elapsed < 10_000, `troppo lento: ${elapsed} ms`);
  await t.cleanup();
});

test('invio codici: un doppio clic non genera codici doppi', async () => {
  const t = await setup();
  const auth = await login(t.app);
  await adminPost(t.app, auth, '/admin/votazioni', { title: 'X', assemblyDate: '2026-10-31', durationMin: '5' });
  await adminPost(t.app, auth, '/admin/v/1/eleggibili', { csv: CSV });
  await adminPost(t.app, auth, '/admin/v/1/presenti', { csv: CSV });
  const [a, b] = await Promise.all([adminPost(t.app, auth, '/admin/v/1/codici/email'), adminPost(t.app, auth, '/admin/v/1/codici/email')]);
  // il secondo clic viene rifiutato (invio in corso) oppure non trova più nessuno da servire
  assert.ok([a.statusCode, b.statusCode].includes(200));
  assert.ok([a, b].every((r) => r.statusCode === 200 || /già in corso/.test(r.json().error)));
  const voters = t.db.prepare('SELECT COUNT(*) n FROM voters').get().n;
  assert.equal(t.outbox.length, voters);
  assert.equal(t.db.prepare('SELECT COUNT(*) n FROM codes WHERE revoked = 0').get().n, voters);
  await t.cleanup();
});

test('versione e pagine di servizio', async () => {
  const t = await setup();
  const h = (await t.app.inject({ url: '/healthz' })).json();
  assert.match(h.version, /^\d+\.\d+\.\d+/);
  assert.match((await t.app.inject({ url: '/robots.txt' })).body, /Disallow: \//);
  const login = await t.app.inject({ url: '/admin/login' });
  assert.match(login.body, new RegExp(`versione ${h.version.replace(/\./g, '\\.')}`));
  assert.match(login.headers['content-security-policy'], /default-src 'self'/);
  await t.cleanup();
});

test('invio codici: con un server email lento il secondo invio viene bloccato', async () => {
  const t = await setup();
  const auth = await login(t.app);
  await adminPost(t.app, auth, '/admin/votazioni', { title: 'X', assemblyDate: '2026-10-31', durationMin: '5' });
  await adminPost(t.app, auth, '/admin/v/1/eleggibili', { csv: CSV });
  await adminPost(t.app, auth, '/admin/v/1/presenti', { csv: CSV });
  const { sendCodesByEmail } = await import('../src/services/voters.js');
  const slow = { configured: true, sent: 0, async send() { await new Promise((r) => setTimeout(r, 20)); this.sent++; } };
  const first = sendCodesByEmail(t.db, t.cfg, slow, 1);
  await assert.rejects(sendCodesByEmail(t.db, t.cfg, slow, 1), /già in corso/);
  const r = await first;
  assert.equal(r.sent, t.db.prepare('SELECT COUNT(*) n FROM voters').get().n);
  await t.cleanup();
});

test('sicurezza: con la sola password non si può riconfigurare la verifica a due fattori', async () => {
  const { generateTotpSecret, totpAt } = await import('../src/lib/crypto.js');
  const t = await setup();
  const real = generateTotpSecret();
  t.db.prepare('UPDATE admins SET totp_secret = ?').run(real);
  const auth = await login(t.app);
  const evil = generateTotpSecret();
  for (const url of ['/admin/2fa/attiva', '/admin']) {
    const r = await t.app.inject({ url, cookies: { sid: auth.sid } });
    assert.equal(r.statusCode, 303);
    assert.equal(r.headers.location, '/admin/2fa');
  }
  const r = await t.app.inject({ method: 'POST', url: '/admin/2fa/attiva', cookies: { sid: auth.sid }, payload: { secret: evil, token: totpAt(evil, Date.now()) } });
  assert.equal(r.headers.location, '/admin/2fa');
  assert.equal(t.db.prepare('SELECT totp_secret FROM admins').get().totp_secret, real, 'il segreto non deve cambiare');
  // con il codice giusto si entra
  const ok = await t.app.inject({ method: 'POST', url: '/admin/2fa', cookies: { sid: auth.sid }, payload: { token: totpAt(real, Date.now()) } });
  assert.equal(ok.headers.location, '/admin');
  assert.equal((await t.app.inject({ url: '/admin', cookies: { sid: auth.sid } })).statusCode, 200);
  await t.cleanup();
});

test('ballottaggi: parità su due domande, due ballottaggi uno dopo l\'altro', async () => {
  const t = await setup();
  const auth = await login(t.app);
  await adminPost(t.app, auth, '/admin/votazioni', { title: 'Cariche', assemblyDate: '2026-10-31', durationMin: '5' });
  for (const title of ['Presidente', 'Segretario']) await adminPost(t.app, auth, '/admin/v/1/domande', { title, seats: '1', maxPrefs: '1' });
  const qs = t.db.prepare('SELECT id FROM questions ORDER BY id').all().map((r) => r.id);
  for (const n of ['A A', 'B B']) await adminPost(t.app, auth, `/admin/domande/${qs[0]}/candidati`, { name: n });
  for (const n of ['C C', 'D D']) await adminPost(t.app, auth, `/admin/domande/${qs[1]}/candidati`, { name: n });
  await adminPost(t.app, auth, '/admin/v/1/eleggibili', { csv: CSV });
  await adminPost(t.app, auth, '/admin/v/1/presenti', { csv: CSV });
  await adminPost(t.app, auth, '/admin/v/1/codici/email');
  const codes = codesFrom(t.outbox);
  await adminPost(t.app, auth, '/admin/v/1/apri');
  const r1 = E.currentRound(t.db, 1);
  const [q1, q2] = r1.ballot.questions;
  const ballot = (i) => ({ answers: { [q1.id]: { picks: [{ id: q1.candidates[i].id }] }, [q2.id]: { picks: [{ id: q2.candidates[i].id }] } } });
  await vote({ app: t.app }, r1.slug, codes[0], ballot(0));
  await vote({ app: t.app }, r1.slug, codes[1], ballot(1));
  await adminPost(t.app, auth, '/admin/v/1/chiudi');
  assert.equal(E.pendingTies(t.db, 1).length, 2);
  // primo ballottaggio (Presidente)
  let r = await adminPost(t.app, auth, '/admin/v/1/ballottaggio', { round: String(r1.id), question: q1.id });
  assert.equal(r.statusCode, 200, r.body);
  // non se ne prepara un altro finché questo non è chiuso
  r = await adminPost(t.app, auth, '/admin/v/1/ballottaggio', { round: String(r1.id), question: q2.id });
  assert.equal(r.statusCode, 400);
  await adminPost(t.app, auth, '/admin/v/1/apri');
  const r2 = E.currentRound(t.db, 1);
  await vote({ app: t.app }, r2.slug, codes[0], { answers: { [r2.ballot.questions[0].id]: { picks: [{ id: 'b1' }] } } });
  await adminPost(t.app, auth, '/admin/v/1/chiudi');
  // resta la parità del Segretario, dal primo turno
  const pending = E.pendingTies(t.db, 1);
  assert.deepEqual(pending.map((p) => p.questionId), [q2.id]);
  r = await adminPost(t.app, auth, '/admin/v/1/ballottaggio', { round: String(r1.id), question: q2.id });
  assert.equal(r.statusCode, 200, r.body);
  assert.match(E.currentRound(t.db, 1).note, /Segretario — ballottaggio/);
  // lo stesso ballottaggio non si prepara due volte
  await adminPost(t.app, auth, '/admin/v/1/apri');
  await adminPost(t.app, auth, '/admin/v/1/chiudi');
  r = await adminPost(t.app, auth, '/admin/v/1/ballottaggio', { round: String(r1.id), question: q1.id });
  assert.equal(r.statusCode, 400);
  await t.cleanup();
});

test('proroga: rifiutata se il tempo è già scaduto', async () => {
  const t = await prepare();
  const round = await open(t);
  assert.throws(() => E.extendRound(t.db, round.id, round.ends_at + 10), /non è aperto/);
  assert.equal(E.getRound(t.db, round.id).status, 'chiusa');
  await t.cleanup();
});

test('reinvio fallito: il codice precedente resta valido', async () => {
  let fail = false;
  const t = await setup({ smtpFails: () => fail });
  const auth = await login(t.app);
  await adminPost(t.app, auth, '/admin/votazioni', { title: 'X', assemblyDate: '2026-10-31', durationMin: '5' });
  await adminPost(t.app, auth, '/admin/v/1/domande', { title: 'P', seats: '1', maxPrefs: '1' });
  const qid = t.db.prepare('SELECT id FROM questions').get().id;
  await adminPost(t.app, auth, `/admin/domande/${qid}/candidati`, { name: 'A A' });
  await adminPost(t.app, auth, '/admin/v/1/eleggibili', { csv: CSV });
  await adminPost(t.app, auth, '/admin/v/1/presenti', { csv: CSV });
  await adminPost(t.app, auth, '/admin/v/1/codici/email');
  const voter = t.db.prepare("SELECT id FROM voters WHERE email = 'g@example.test'").get();
  const [oldCode] = codesFrom(t.outbox.filter((m) => m.to === 'g@example.test'));
  fail = true;
  const r = await adminPost(t.app, auth, `/admin/v/1/soci/${voter.id}/reinvia`);
  assert.equal(r.statusCode, 400);
  assert.equal(t.db.prepare('SELECT code_status FROM voters WHERE id = ?').get(voter.id).code_status, 'email');
  await adminPost(t.app, auth, '/admin/v/1/apri');
  const round = E.currentRound(t.db, 1);
  const q = round.ballot.questions[0];
  const v = await vote({ app: t.app }, round.slug, oldCode, { answers: { [q.id]: { picks: [{ id: q.candidates[0].id }] } } });
  assert.equal(v.statusCode, 200);
  await t.cleanup();
});

test('sala: un IP condiviso con molti telefoni non viene bloccato', async () => {
  const t = await prepare();
  const round = await open(t);
  for (let i = 0; i < 400; i++) await t.app.inject({ url: `/api/v/${round.slug}` });
  for (let i = 0; i < 40; i++) await t.app.inject({ method: 'POST', url: `/api/v/${round.slug}/codice`, payload: { code: 'ABCD' } }); // refusi
  const r = await vote(t, round.slug, t.codes[0], pick(round, 'Marco Russo'));
  assert.equal(r.statusCode, 200);
  await t.cleanup();
});

test('reinvio a voto aperto: il codice precedente smette subito di valere', async () => {
  const t = await prepare();
  const round = await open(t);
  const voter = t.db.prepare("SELECT id FROM voters WHERE email = 'g@example.test'").get();
  const [oldCode] = codesFrom(t.outbox.filter((m) => m.to === 'g@example.test'));
  const before = t.outbox.length;
  assert.equal((await adminPost(t.app, t.auth, `/admin/v/${t.eid}/soci/${voter.id}/reinvia`)).statusCode, 200);
  const [newCode] = codesFrom(t.outbox.slice(before));
  assert.equal((await vote(t, round.slug, oldCode, pick(round, 'Marco Russo'))).json().code, 'invalid');
  assert.equal((await vote(t, round.slug, newCode, pick(round, 'Marco Russo'))).statusCode, 200);
  await t.cleanup();
});
