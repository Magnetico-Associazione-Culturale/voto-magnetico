// Pannello di amministrazione: login con password + verifica a due fattori,
// gestione delle votazioni, schermo da proiettare, risultati.
import QRCode from 'qrcode';
import { layout } from '../views/layout.js';
import * as V from '../views/admin.js';
import { html } from '../lib/html.js';
import { toCsv } from '../lib/csv.js';
import { formatDay } from '../lib/dates.js';
import { randomId, sha256, hashPassword, verifyPassword, verifyTotp, generateTotpSecret, totpUri } from '../lib/crypto.js';
import * as E from '../services/elections.js';
import * as VT from '../services/voters.js';
import { tallyRound, savePaper, deletePaper } from '../services/tally.js';
import { ipKey } from '../lib/net.js';

const SESSION_HOURS = 12;
// Hash fittizio: se l'utente non esiste si fa comunque il calcolo, così i tempi di risposta
// non rivelano quali nomi utente esistono.
const DUMMY_HASH = hashPassword(randomId());
const SESSION_COOKIE = 'sid';

export async function adminRoutes(app) {
  const { db, cfg, mailer, limit } = app.ctx;
  const cookieOpts = { path: '/', httpOnly: true, sameSite: 'strict', secure: cfg.secureCookies };

  // --- sessioni ---
  function loadSession(req) {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT s.token_hash, s.totp_ok, s.expires_at, a.id, a.username, a.totp_secret
         FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ?`,
      )
      .get(sha256(token));
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  function startSession(reply, adminId, totpOk) {
    const token = randomId(32);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO sessions (token_hash, admin_id, totp_ok, expires_at) VALUES (?, ?, ?, ?)').run(
      sha256(token),
      adminId,
      totpOk ? 1 : 0,
      Date.now() + SESSION_HOURS * 3600_000,
    );
    reply.setCookie(SESSION_COOKIE, token, { ...cookieOpts, maxAge: SESSION_HOURS * 3600 });
  }

  // --- messaggi flash (una volta sola) ---
  function setFlash(reply, flash) {
    reply.setCookie('flash', Buffer.from(JSON.stringify(flash)).toString('base64url'), { ...cookieOpts, maxAge: 60 });
  }
  function takeFlash(req, reply) {
    const v = req.cookies.flash;
    if (!v) return null;
    reply.clearCookie('flash', { path: '/' });
    try {
      return JSON.parse(Buffer.from(v, 'base64url').toString());
    } catch {
      return null;
    }
  }

  function page(req, reply, { title, body, scripts = ['admin.js'], bodyClass = '' }) {
    return reply
      .type('text/html')
      .send(layout({ title, body, admin: req.admin, flash: takeFlash(req, reply), scripts, bodyClass, version: cfg.version }));
  }

  const wantsJson = (req) => (req.headers.accept ?? '').includes('application/json');

  function backTo(req, fallback = '/admin') {
    try {
      const u = new URL(req.headers.referer ?? '');
      if (u.host === req.headers.host && u.pathname.startsWith('/admin')) return u.pathname + u.search;
    } catch {
      /* nessun referer */
    }
    return fallback;
  }

  // Esegue un'azione da form: in caso di errore "utente" mostra il messaggio e torna indietro.
  const action = (fn) => async (req, reply) => {
    try {
      const r = (await fn(req, reply)) ?? {};
      if (reply.sent) return;
      if (wantsJson(req)) return reply.send({ ok: true, ...r.json });
      if (r.ok) setFlash(reply, { ok: r.ok });
      return reply.redirect(r.to ?? backTo(req), 303);
    } catch (err) {
      if (!(err instanceof E.UserError)) throw err;
      if (wantsJson(req)) return reply.code(400).send({ error: err.message });
      setFlash(reply, { error: err.message });
      return reply.redirect(backTo(req), 303);
    }
  };

  const log = (req, electionId, text) => E.logAction(db, req.admin.username, electionId, text);

  // --- controllo accessi per tutto /admin ---
  app.addHook('preHandler', async (req, reply) => {
    const url = req.routeOptions?.url ?? '';
    if (!url.startsWith('/admin')) return;
    if (url === '/admin/login') return;
    const s = loadSession(req);
    if (!s) {
      if (url.startsWith('/admin/api')) return reply.code(401).send({ error: 'Sessione scaduta: accedi di nuovo' });
      return reply.redirect('/admin/login', 303);
    }
    req.admin = { id: s.id, username: s.username, tokenHash: s.token_hash, has2fa: !!s.totp_secret, totpOk: !!s.totp_ok };
    // Con la verifica già attiva ma non ancora superata in questa sessione si può solo verificare o uscire:
    // in particolare NON si può riconfigurare la verifica (altrimenti basterebbe la password).
    if (s.totp_secret && !s.totp_ok && !['/admin/2fa', '/admin/logout'].includes(url)) return reply.redirect('/admin/2fa', 303);
    if (!s.totp_secret && cfg.require2fa && !['/admin/2fa/attiva', '/admin/logout'].includes(url)) {
      return reply.redirect('/admin/2fa/attiva', 303);
    }
  });

  // --- login ---
  app.get('/admin/login', async (req, reply) => {
    if (loadSession(req)) return reply.redirect('/admin', 303);
    return reply.type('text/html').send(layout({ title: 'Accesso', body: V.loginPage(), version: cfg.version }));
  });

  app.post('/admin/login', async (req, reply) => {
    const username = String(req.body?.username ?? '').trim();
    const fail = (msg) => reply.code(401).type('text/html').send(layout({ title: 'Accesso', body: V.loginPage({ error: msg }), version: cfg.version }));
    if (!limit(`login:${ipKey(req.ip)}`, 10, 5 * 60_000)) {
      return fail('Troppi tentativi. Attendi qualche minuto.');
    }
    const a = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    const okPassword = verifyPassword(String(req.body?.password ?? ''), a?.pass_hash ?? DUMMY_HASH);
    if (!a || !okPassword) return fail('Nome utente o password errati.');
    startSession(reply, a.id, false);
    E.logAction(db, a.username, null, 'Accesso');
    return reply.redirect(a.totp_secret ? '/admin/2fa' : cfg.require2fa ? '/admin/2fa/attiva' : '/admin', 303);
  });

  app.post('/admin/logout', async (req, reply) => {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.admin.tokenHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/admin/login', 303);
  });

  app.get('/admin/2fa', async (req, reply) => {
    return reply.type('text/html').send(layout({ title: 'Verifica', body: V.totpPage(), version: cfg.version }));
  });

  app.post('/admin/2fa', async (req, reply) => {
    const a = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
    if (!a.totp_secret) return reply.redirect('/admin/2fa/attiva', 303);
    if (!limit(`totp:${a.id}`, 6, 5 * 60_000) || !verifyTotp(a.totp_secret, req.body?.token)) {
      return reply.code(401).type('text/html').send(layout({ title: 'Verifica', body: V.totpPage({ error: 'Codice non valido o troppi tentativi.' }), version: cfg.version }));
    }
    db.prepare('UPDATE sessions SET totp_ok = 1 WHERE token_hash = ?').run(req.admin.tokenHash);
    return reply.redirect('/admin', 303);
  });

  async function setupView(req, reply, { secret, error } = {}) {
    const s = secret ?? generateTotpSecret();
    const qrSvg = await QRCode.toString(totpUri(s, req.admin.username), { type: 'svg', margin: 1 });
    return page(req, reply, { title: 'Verifica a due fattori', body: V.totpSetupPage({ secret: s, qrSvg, required: cfg.require2fa, error }) });
  }

  app.get('/admin/2fa/attiva', async (req, reply) => setupView(req, reply));

  app.post('/admin/2fa/attiva', async (req, reply) => {
    // Doppio controllo (oltre al preHandler): riconfigurare richiede la verifica già superata.
    if (req.admin.has2fa && !req.admin.totpOk) return reply.redirect('/admin/2fa', 303);
    const secret = String(req.body?.secret ?? '');
    if (!/^[A-Z2-7]{32}$/.test(secret) || !verifyTotp(secret, req.body?.token)) {
      return setupView(req, reply, { secret: /^[A-Z2-7]{32}$/.test(secret) ? secret : undefined, error: 'Codice non valido, riprova.' });
    }
    db.prepare('UPDATE admins SET totp_secret = ? WHERE id = ?').run(secret, req.admin.id);
    db.prepare('UPDATE sessions SET totp_ok = 1 WHERE token_hash = ?').run(req.admin.tokenHash);
    E.logAction(db, req.admin.username, null, 'Verifica a due fattori attivata');
    setFlash(reply, { ok: 'Verifica a due fattori attivata.' });
    return reply.redirect('/admin', 303);
  });

  // --- votazioni ---
  app.get('/admin', async (req, reply) => {
    const has2fa = !!db.prepare('SELECT totp_secret FROM admins WHERE id = ?').get(req.admin.id).totp_secret;
    const body = html`${has2fa ? '' : html`<div class="flash error">La verifica a due fattori non è attiva per il tuo account. <a href="/admin/2fa/attiva">Attivala ora</a>.</div>`}${V.dashboardPage({ elections: E.listElections(db) })}`;
    return page(req, reply, { title: 'Votazioni', body });
  });

  app.post(
    '/admin/votazioni',
    action(async (req) => {
      const id = E.createElection(db, req.body ?? {});
      log(req, id, 'Votazione creata');
      return { to: `/admin/v/${id}`, ok: 'Votazione creata. Ora prepara la scheda e importa gli aventi diritto.' };
    }),
  );

  function electionData(id) {
    const election = E.getElection(db, id);
    E.closeExpired(db);
    const rounds = E.getRounds(db, id);
    const current = rounds[rounds.length - 1];
    return {
      election,
      rounds,
      current,
      questions: E.getQuestions(db, id),
      voters: VT.listVoters(db, id),
      eligibles: VT.listEligibles(db, id),
      stats: VT.codeStats(db, id, current.status === 'bozza' ? null : current.id),
      editable: E.isEditable(db, id),
      hasCodes: VT.hasCodes(db, id),
      canIssue: rounds[0].status !== 'chiusa',
      log: E.getLog(db, id),
      mailConfigured: mailer.configured,
    };
  }

  app.get('/admin/v/:id', async (req, reply) => {
    let d;
    try {
      d = electionData(req.params.id);
    } catch (err) {
      if (err instanceof E.UserError) return reply.callNotFound();
      throw err;
    }
    d.report = importReports.get(reportKey(req));
    importReports.delete(reportKey(req));
    return page(req, reply, { title: d.election.title, body: V.electionPage(d) });
  });

  app.post(
    '/admin/v/:id/impostazioni',
    action(async (req) => {
      E.updateElection(db, req.params.id, req.body ?? {});
      log(req, req.params.id, 'Impostazioni modificate');
      return { ok: 'Impostazioni salvate.' };
    }),
  );

  const qData = (b = {}) => ({ title: b.title, seats: Number(b.seats), maxPrefs: Number(b.maxPrefs), allowWriteIn: b.allowWriteIn === '1' });

  app.post(
    '/admin/v/:id/domande',
    action(async (req) => {
      E.addQuestion(db, req.params.id, qData(req.body));
      log(req, req.params.id, `Domanda aggiunta: ${req.body.title}`);
      return { ok: 'Domanda aggiunta.' };
    }),
  );
  app.post(
    '/admin/domande/:qid',
    action(async (req) => {
      const eid = E.updateQuestion(db, req.params.qid, qData(req.body));
      log(req, eid, `Domanda modificata: ${req.body.title}`);
      return { ok: 'Domanda salvata.' };
    }),
  );
  app.post(
    '/admin/domande/:qid/elimina',
    action(async (req) => {
      const eid = E.deleteQuestion(db, req.params.qid);
      log(req, eid, 'Domanda eliminata');
      return { ok: 'Domanda eliminata.' };
    }),
  );
  app.post(
    '/admin/domande/:qid/candidati',
    action(async (req) => {
      const eid = E.addCandidate(db, req.params.qid, req.body?.name);
      log(req, eid, `Candidato aggiunto: ${req.body.name}`);
      return {};
    }),
  );
  app.post(
    '/admin/candidati/:cid/elimina',
    action(async (req) => {
      const c = db.prepare('SELECT name FROM candidates WHERE id = ?').get(Number(req.params.cid));
      const eid = E.deleteCandidate(db, req.params.cid);
      log(req, eid, `Candidato tolto: ${c?.name}`);
      return {};
    }),
  );

  // --- aventi diritto e codici ---
  // Riepilogo dell'ultimo import, mostrato una volta nella pagina della votazione.
  // Solo in memoria: contiene nomi, quindi non va nel database né nei cookie.
  const importReports = new Map();
  const reportKey = (req) => `${req.admin.id}:${Number(req.params.id)}`;
  const excludedLines = (excluded) => excluded.map((x) => `Riga ${x.line} · ${x.name} — ${x.reason}`);

  app.post(
    '/admin/v/:id/eleggibili',
    action(async (req) => {
      const r = VT.importEligibles(db, req.params.id, req.body ?? {});
      log(req, req.params.id, `Anagrafica importata: ${r.eligibles} eleggibili, ${r.excluded.length} esclusi`);
      importReports.set(reportKey(req), {
        title: `Eleggibili importati: ${r.eligibles}`,
        intro: `Criteri alla data dell'assemblea (${r.day}): socio attivo, maggiorenne, tessera non scaduta.${r.homonyms ? ` ${r.homonyms} omonimi: nella scheda compaiono con l'anno di nascita.` : ''}`,
        groups: [{ label: `Esclusi (${r.excluded.length})`, items: excludedLines(r.excluded) }],
      });
      return { ok: `Importati ${r.eligibles} eleggibili${r.excluded.length ? `, ${r.excluded.length} esclusi (vedi il riepilogo)` : ''}.`, json: r };
    }),
  );
  app.post(
    '/admin/v/:id/presenti',
    action(async (req) => {
      const r = VT.importVoters(db, req.params.id, req.body ?? {});
      log(req, req.params.id, `Presenti importati: ${r.added} nuovi aventi diritto, ${r.already} già in elenco, ${r.excluded.length} esclusi`);
      importReports.set(reportKey(req), {
        title: `Aventi diritto aggiunti: ${r.added}`,
        intro: `Criteri alla data dell'assemblea (${r.day}): socio attivo, maggiorenne, tessera non scaduta.${r.already ? ` ${r.already} erano già in elenco e mantengono il loro codice.` : ''}`,
        groups: [
          { label: `Esclusi (${r.excluded.length})`, items: excludedLines(r.excluded) },
          { label: `Senza email: riceveranno il cartellino stampato (${r.noEmail.length})`, items: r.noEmail },
          { label: `Email non valida: correggila nell'elenco o stampa il cartellino (${r.badEmail.length})`, items: r.badEmail },
        ],
      });
      return { ok: `Aggiunti ${r.added} aventi diritto${r.excluded.length ? `, ${r.excluded.length} esclusi (vedi il riepilogo)` : ''}.`, json: r };
    }),
  );
  app.post(
    '/admin/v/:id/elenco/svuota',
    action(async (req) => {
      VT.clearVoters(db, req.params.id);
      log(req, req.params.id, 'Elenco e codici svuotati');
      return { ok: 'Elenco svuotato.' };
    }),
  );
  app.post(
    '/admin/v/:id/soci',
    action(async (req) => {
      VT.addVoter(db, req.params.id, req.body ?? {});
      log(req, req.params.id, 'Avente diritto aggiunto a mano');
      return { ok: 'Avente diritto aggiunto.' };
    }),
  );
  app.post(
    '/admin/v/:id/soci/:vid/email',
    action(async (req) => {
      VT.updateVoterEmail(db, req.params.id, req.params.vid, req.body?.email);
      return { ok: 'Email aggiornata.' };
    }),
  );
  app.post(
    '/admin/v/:id/codici/email',
    action(async (req) => {
      const r = await VT.sendCodesByEmail(db, cfg, mailer, req.params.id, { username: req.admin.username });
      if (r.failed.length) {
        throw new E.UserError(
          `Inviate ${r.sent} email. Errori (${r.failed.length}): ${r.failed.slice(0, 10).map((f) => `${f.name} <${f.email}>: ${f.error}`).join('; ')}`,
        );
      }
      return { ok: `Inviate ${r.sent} email con i codici.` };
    }),
  );
  app.post(
    '/admin/v/:id/soci/:vid/reinvia',
    action(async (req) => {
      const r = await VT.sendCodesByEmail(db, cfg, mailer, req.params.id, { voterIds: [Number(req.params.vid)], username: req.admin.username });
      if (r.failed.length) throw new E.UserError(`Invio non riuscito: ${r.failed[0].error}`);
      return { ok: 'Nuovo codice inviato.' };
    }),
  );

  async function printCards(req, reply, voterIds) {
    const election = E.getElection(db, req.params.id);
    let cards;
    try {
      cards = VT.issuePrintedCodes(db, cfg, req.params.id, { voterIds, username: req.admin.username });
    } catch (err) {
      if (!(err instanceof E.UserError)) throw err;
      return page(req, reply, { title: 'Errore', body: html`<section class="card"><p class="flash error">${err.message}</p></section>` });
    }
    return page(req, reply, { title: 'Cartellini', body: V.printCardsPage({ election, cards }), bodyClass: 'print-page' });
  }
  app.post('/admin/v/:id/codici/stampa', async (req, reply) => printCards(req, reply, null));
  app.post('/admin/v/:id/soci/:vid/stampa', async (req, reply) => printCards(req, reply, [Number(req.params.vid)]));

  // --- svolgimento del voto ---
  app.post(
    '/admin/v/:id/apri',
    action(async (req) => {
      const r = E.openRound(db, req.params.id);
      log(req, req.params.id, `${E.roundLabel(r)}: voto aperto`);
      return { ok: 'Voto aperto.' };
    }),
  );
  app.post(
    '/admin/v/:id/proroga',
    action(async (req) => {
      const r = E.currentRound(db, req.params.id);
      E.extendRound(db, r.id);
      log(req, req.params.id, `${E.roundLabel(r)}: proroga di 2 minuti`);
      return { ok: 'Voto prorogato di 2 minuti.' };
    }),
  );
  app.post(
    '/admin/v/:id/chiudi',
    action(async (req) => {
      const r = E.currentRound(db, req.params.id);
      if (r.status !== 'aperta') throw new E.UserError('Il voto non è aperto');
      E.closeRound(db, r.id);
      log(req, req.params.id, `${E.roundLabel(r)}: voto chiuso manualmente`);
      return { ok: 'Voto chiuso.' };
    }),
  );
  app.post(
    '/admin/v/:id/risultati/visibilita',
    action(async (req) => {
      const r = E.currentRound(db, req.params.id);
      const hidden = req.body?.hidden === '1' || req.body?.hidden === true;
      E.setResultsHidden(db, r.id, hidden);
      log(req, req.params.id, `${E.roundLabel(r)}: risultati ${hidden ? 'nascosti' : 'mostrati'} sullo schermo`);
      return {};
    }),
  );
  app.post(
    '/admin/v/:id/ballottaggio',
    action(async (req) => {
      E.createRunoff(db, req.params.id, Number(req.body?.round), String(req.body?.question ?? ''));
      log(req, req.params.id, 'Ballottaggio preparato');
      return { ok: 'Ballottaggio preparato: aprilo dallo schermo o dalla pagina della votazione.', to: `/admin/v/${req.params.id}` };
    }),
  );

  // --- schermo da proiettare ---
  app.get('/admin/v/:id/schermo', async (req, reply) => {
    const election = E.getElection(db, req.params.id);
    return page(req, reply, { title: `Schermo — ${election.title}`, body: V.screenPage({ election }), scripts: ['screen.js'], bodyClass: 'screen' });
  });

  const qrCache = new Map();
  async function qrFor(url) {
    if (!qrCache.has(url)) qrCache.set(url, await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }));
    return qrCache.get(url);
  }

  app.get('/admin/api/v/:id/stato', async (req, reply) => {
    E.closeExpired(db);
    const election = E.getElection(db, req.params.id);
    const rounds = E.getRounds(db, election.id);
    const r = rounds[rounds.length - 1];
    const base = cfg.publicUrl || `${req.protocol}://${req.headers.host}`;
    const out = {
      election: { id: election.id, title: election.title, durationSec: election.duration_sec },
      round: {
        id: r.id,
        number: r.number,
        label: E.roundLabel(r),
        status: r.status,
        endsAt: r.ends_at,
        extended: !!r.extended,
        resultsHidden: !!r.results_hidden,
        note: r.note,
      },
      serverNow: Date.now(),
      stats: VT.codeStats(db, election.id, r.status === 'bozza' ? null : r.id),
      localhostWarning: !cfg.publicUrl && /^(localhost|127\.)/.test(req.headers.host ?? ''),
    };
    if (r.status === 'aperta') {
      out.voteUrl = `${base}/v/${r.slug}`;
      out.voteUrlShort = out.voteUrl.replace(/^https?:\/\//, '');
      out.qrSvg = await qrFor(out.voteUrl);
    }
    if (r.status === 'chiusa') {
      out.ties = E.pendingTies(db, election.id).map((t) => ({ round: t.roundId, id: t.questionId, title: t.title, names: t.names }));
      if (!r.results_hidden) out.results = tallyRound(db, r);
    }
    return out;
  });

  // --- risultati e verbale ---
  function closedRounds(id) {
    const rounds = E.getRounds(db, id);
    return rounds
      .filter((r) => r.status === 'chiusa')
      .map((r) => ({ round: { ...r, isLast: r.id === rounds[rounds.length - 1].id }, result: tallyRound(db, r) }));
  }

  app.get('/admin/v/:id/risultati', async (req, reply) => {
    const election = E.getElection(db, req.params.id);
    const pending = new Set(E.pendingTies(db, election.id).map((t) => `${t.roundId}:${t.questionId}`));
    const canRunoff = E.currentRound(db, election.id).status === 'chiusa';
    return page(req, reply, { title: `Risultati — ${election.title}`, body: V.resultsPage({ election, rounds: closedRounds(election.id), pending, canRunoff }) });
  });

  app.post(
    '/admin/v/:id/turni/:rid/cartacee',
    action(async (req) => {
      const round = E.getRound(db, req.params.rid);
      if (round.election_id !== Number(req.params.id) || round.status !== 'chiusa') throw new E.UserError('Turno non valido');
      const b = req.body ?? {};
      const qid = String(b.question ?? '');
      if (!round.ballot.questions.some((q) => q.id === qid)) throw new E.UserError('Domanda non valida');
      if (b.delete === '1') {
        deletePaper(db, round.id, qid);
        log(req, round.election_id, `${E.roundLabel(round)}: schede cartacee rimosse`);
        return { ok: 'Schede cartacee rimosse.' };
      }
      const num = (v) => {
        const n = Number(v || 0);
        if (!Number.isInteger(n) || n < 0) throw new E.UserError('I valori devono essere numeri interi non negativi');
        return n;
      };
      const votes = {};
      for (const [k, v] of Object.entries(b)) if (k.startsWith('v:') && num(v) > 0) votes[k.slice(2)] = num(v);
      for (const line of String(b.others ?? '').split(/\r?\n/)) {
        if (!line.trim()) continue;
        const m = line.match(/^(.+?)[;,\t]\s*(\d+)\s*$/);
        if (!m) throw new E.UserError(`Riga non valida: «${line}». Usa il formato «Nome Cognome; voti»`);
        const name = m[1].trim().replace(/\s+/g, ' ');
        votes[name] = (votes[name] ?? 0) + num(m[2]);
      }
      savePaper(db, round.id, qid, { votes, bianche: num(b.bianche), nulle: num(b.nulle), schede: num(b.schede) });
      log(req, round.election_id, `${E.roundLabel(round)}: schede cartacee inserite`);
      return { ok: 'Schede cartacee salvate. Sono sommate ai voti online ma restano su righe separate.' };
    }),
  );

  app.get('/admin/v/:id/risultati.csv', async (req, reply) => {
    const election = E.getElection(db, req.params.id);
    const rows = [['Votazione', election.title], ['Data', formatDay(election.assembly_date)], []];
    for (const { round, result } of closedRounds(election.id)) {
      rows.push([E.roundLabel(round), round.note]);
      rows.push(['Schede online', result.totalBallots], ['Astenuti', result.abstained], ['Codici usati', result.usedCodes]);
      rows.push(['Riconciliazione (codici usati = schede)', result.reconciled ? 'corretta' : 'NON corretta']);
      for (const q of result.questions) {
        rows.push([], ['Domanda', q.title, `${q.seats} posti`], ['Nome', 'Voti online', 'Voti cartacei', 'Totale', 'Esito']);
        for (const r of q.ranking) rows.push([r.name, r.online, r.paper, r.total, q.elected.includes(r.name) ? 'Eletto/a' : q.tie?.names.includes(r.name) ? 'Parità' : '']);
        rows.push(['Schede bianche', q.blank, q.paper?.bianche ?? 0, q.blank + (q.paper?.bianche ?? 0)]);
        if (q.paper) rows.push(['Schede nulle', '', q.paper.nulle, q.paper.nulle], ['Schede cartacee totali', '', q.paper.schede]);
      }
      rows.push([]);
    }
    const name = `risultati-${election.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.csv`;
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}"`).send(toCsv(rows));
  });

  // --- dati personali e eliminazione ---
  app.post(
    '/admin/v/:id/dati-personali/elimina',
    action(async (req) => {
      VT.deletePersonalData(db, req.params.id);
      log(req, req.params.id, 'Dati personali degli aventi diritto cancellati');
      return { ok: 'Dati personali cancellati.' };
    }),
  );
  app.post(
    '/admin/v/:id/elimina',
    action(async (req) => {
      const e = E.getElection(db, req.params.id);
      E.deleteElection(db, e.id);
      E.logAction(db, req.admin.username, null, `Votazione eliminata: ${e.title}`);
      return { to: '/admin', ok: 'Votazione eliminata.' };
    }),
  );
}
