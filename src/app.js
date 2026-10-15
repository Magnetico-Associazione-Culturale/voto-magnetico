import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { voterRoutes } from './routes/voter.js';
import { adminRoutes } from './routes/admin.js';
import { layout } from './views/layout.js';
import { html } from './lib/html.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

// Limitatore di richieste in memoria (nessun IP viene salvato su disco o nei log).
export function createRateLimiter() {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
  }, 60_000).unref();
  // limit(key, max): conta una richiesta e dice se si è ancora sotto il limite.
  const limit = (key, max, windowMs = 60_000) => {
    const now = Date.now();
    let e = hits.get(key);
    if (!e || e.reset < now) {
      e = { n: 0, reset: now + windowMs };
      hits.set(key, e);
    }
    e.n++;
    return e.n <= max;
  };
  // limit.over(key, max): dice se il limite è già superato, senza contare.
  limit.over = (key, max) => {
    const e = hits.get(key);
    return !!e && e.reset >= Date.now() && e.n >= max;
  };
  return limit;
}

export async function buildApp({ cfg, db, mailer }) {
  const app = Fastify({ logger: false, trustProxy: cfg.trustProxy, bodyLimit: 5 * 1024 * 1024 });
  app.decorate('ctx', { cfg, db, mailer, limit: createRateLimiter() });

  await app.register(cookie);
  await app.register(formbody);

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
    );
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    if (cfg.secureCookies) reply.header('Strict-Transport-Security', 'max-age=31536000');
    return payload;
  });

  // Protezione CSRF: le richieste POST devono arrivare dalla stessa origine.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method !== 'POST') return;
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let host;
      try {
        host = new URL(origin).host;
      } catch {
        host = null;
      }
      if (host !== req.headers.host) return reply.code(403).send({ error: 'Origine non consentita' });
    }
  });

  // File statici (lista chiusa, letti all'avvio).
  const files = new Map();
  for (const f of fs.readdirSync(PUBLIC_DIR)) {
    if (!fs.statSync(path.join(PUBLIC_DIR, f)).isFile()) continue;
    files.set(f, { body: fs.readFileSync(path.join(PUBLIC_DIR, f)), type: TYPES[path.extname(f)] ?? 'application/octet-stream' });
  }
  app.get('/static/:file', async (req, reply) => {
    const f = files.get(req.params.file);
    if (!f) return reply.code(404).send('Non trovato');
    // Font e immagini non cambiano tra una versione e l'altra: il telefono li tiene in cache
    // (in sala la rete è condivisa). Script e stili si ricontrollano sempre.
    const stable = /^(font|image)\//.test(f.type);
    return reply.type(f.type).header('Cache-Control', stable ? 'public, max-age=86400' : 'no-cache').send(f.body);
  });

  app.get('/', async (req, reply) => reply.redirect('/admin'));
  app.get('/robots.txt', async (req, reply) => reply.type('text/plain').send('User-agent: *\nDisallow: /\n'));
  app.get('/favicon.ico', async (req, reply) => reply.redirect('/static/simbolo-magnetico.svg'));
  app.get('/healthz', async () => ({ ok: true, version: cfg.version }));

  await app.register(voterRoutes);
  await app.register(adminRoutes);

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Non trovato' });
    reply
      .code(404)
      .type('text/html')
      .send(
        layout({
          title: 'Pagina non disponibile',
          version: cfg.version,
          body: html`<section class="card center"><h1>Pagina non disponibile</h1><p>L'indirizzo non esiste oppure la votazione non è attiva.</p></section>`,
        }),
      );
  });

  app.setErrorHandler((err, req, reply) => {
    // Log minimo: niente corpo della richiesta, niente IP.
    console.error(`[errore] ${req.method} ${req.routeOptions?.url ?? ''}: ${err.message}`);
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (req.url.startsWith('/api/') || req.url.startsWith('/admin/api/')) {
      return reply.code(status).send({ error: status === 500 ? 'Errore interno, riprova' : err.message });
    }
    reply.code(status).type('text/html').send(
      layout({
        title: 'Errore',
        version: cfg.version,
        body: html`<section class="card center"><h1>Si è verificato un errore</h1><p>${status === 500 ? 'Riprova tra qualche secondo.' : err.message}</p><p><a href="/admin">Torna al pannello</a></p></section>`,
      }),
    );
  });

  return app;
}
