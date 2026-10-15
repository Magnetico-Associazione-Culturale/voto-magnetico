// Pagine e API per chi vota. Nessun login: si entra con il codice monouso.
// Nessun dato della richiesta (IP, user agent) viene salvato.
import { layout } from '../views/layout.js';
import { html } from '../lib/html.js';
import { getOpenRoundBySlug, checkCode, castVote, searchEligibles, VoteError } from '../services/voting.js';
import { roundLabel } from '../services/elections.js';
import { ipKey } from '../lib/net.js';

export async function voterRoutes(app) {
  const { db, cfg, limit } = app.ctx;

  // Limiti pensati per la sala: decine di telefoni escono su internet con lo stesso IP,
  // quindi i limiti sono per IP (rete /64 per IPv6) e molto larghi. Non c'è un limite
  // globale: nessuno da fuori deve poter bloccare il voto a tutti. La vera protezione
  // contro i tentativi a tappeto è il codice: ~59 bit, impossibile da indovinare.
  function guard(req, reply, bucket = 'v', max = 3000) {
    if (!limit(`${bucket}:${ipKey(req.ip)}`, max)) {
      reply.code(429).send({ error: 'Troppe richieste, attendi qualche secondo e riprova.' });
      return false;
    }
    return true;
  }
  // Codici sbagliati: si contano solo quelli ben formati ma inesistenti (non i refusi di lunghezza).
  const FAIL_IP = 100;
  function failGuard(req) {
    return !limit.over(`vf:${ipKey(req.ip)}`, FAIL_IP);
  }
  function countFailure(req, err) {
    if (err instanceof VoteError && err.code === 'invalid') limit(`vf:${ipKey(req.ip)}`, FAIL_IP);
  }

  function roundOr404(req, reply) {
    const round = getOpenRoundBySlug(db, req.params.slug);
    if (!round) {
      reply.code(404).send({ error: 'Votazione non trovata' });
      return null;
    }
    return round;
  }

  function sendVoteError(req, reply, err) {
    countFailure(req, err);
    if (err instanceof VoteError) {
      const status = { closed: 409, used: 409, malformed: 400, invalid: 400, ballot: 422 }[err.code] ?? 400;
      return reply.code(status).send({ error: err.message, code: err.code });
    }
    throw err;
  }

  app.get('/v/:slug', async (req, reply) => {
    const round = getOpenRoundBySlug(db, req.params.slug);
    if (!round) return reply.callNotFound();
    reply.type('text/html').send(
      layout({
        title: 'Votazione',
        version: cfg.version,
        bodyClass: 'voter',
        scripts: ['vote.js'],
        body: html`<div id="app" data-slug="${req.params.slug}">
  <section class="card center"><p>Caricamento…</p></section>
</div>
<noscript><section class="card center"><p>Per votare è necessario abilitare JavaScript nel browser.</p></section></noscript>`,
      }),
    );
  });

  app.get('/api/v/:slug', async (req, reply) => {
    if (!guard(req, reply, 'vi', 6000)) return;
    const round = roundOr404(req, reply);
    if (!round) return;
    const e = db.prepare('SELECT title FROM elections WHERE id = ?').get(round.election_id);
    return {
      title: e.title,
      label: roundLabel(round),
      status: round.status,
      endsAt: round.ends_at,
      serverNow: Date.now(),
    };
  });

  app.post('/api/v/:slug/codice', async (req, reply) => {
    if (!guard(req, reply)) return;
    if (!failGuard(req)) return reply.code(429).send({ error: 'Troppi tentativi, attendi un minuto e riprova.' });
    const round = roundOr404(req, reply);
    if (!round) return;
    try {
      checkCode(db, cfg, round, req.body?.code);
    } catch (err) {
      return sendVoteError(req, reply, err);
    }
    return { ok: true, ballot: round.ballot };
  });

  app.post('/api/v/:slug/cerca', async (req, reply) => {
    if (!guard(req, reply)) return;
    if (!failGuard(req)) return reply.code(429).send({ error: 'Troppi tentativi, attendi un minuto e riprova.' });
    const round = roundOr404(req, reply);
    if (!round) return;
    try {
      return { results: searchEligibles(db, cfg, round, req.body?.code, req.body?.question, req.body?.q) };
    } catch (err) {
      return sendVoteError(req, reply, err);
    }
  });

  app.post('/api/v/:slug/vota', async (req, reply) => {
    if (!guard(req, reply)) return;
    if (!failGuard(req)) return reply.code(429).send({ error: 'Troppi tentativi, attendi un minuto e riprova.' });
    const round = roundOr404(req, reply);
    if (!round) return;
    try {
      const r = castVote(db, cfg, round, { code: req.body?.code, content: req.body?.content, nonce: req.body?.nonce });
      return { ok: true, duplicate: r.duplicate };
    } catch (err) {
      return sendVoteError(req, reply, err);
    }
  });
}
