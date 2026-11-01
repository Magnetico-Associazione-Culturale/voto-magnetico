// Schermo da proiettare in sala e condividere su Google Meet.
// Prima dell'apertura: titolo e attesa. Durante il voto: timer, QR code e indirizzo.
// Alla chiusura: risultati (se non nascosti dall'amministratore).
(() => {
  'use strict';
  const root = document.getElementById('screen');
  const main = document.getElementById('screen-main');
  const controls = document.getElementById('screen-controls');
  const id = root.dataset.id;

  let state = null;
  let offset = 0;
  let signature = '';
  let busy = false;
  let errorMsg = '';

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === false || v == null) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }

  const fmt = (ms) => {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  async function act(path, body = {}, confirmText) {
    if (busy) return;
    if (confirmText && !window.confirm(confirmText)) return;
    busy = true;
    errorMsg = '';
    try {
      const res = await fetch(`/admin/v/${id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) errorMsg = data.error || 'Operazione non riuscita';
    } catch {
      errorMsg = 'Connessione assente';
    }
    busy = false;
    signature = '';
    await poll();
  }

  function renderHead() {
    const { election, round } = state;
    const showing = round.status !== 'bozza';
    document.getElementById('screen-head-title').textContent = showing ? election.title : '';
    document.getElementById('screen-head-sub').textContent = showing
      ? `${round.label}${round.status === 'chiusa' && state.results ? ' · Risultati' : round.status === 'chiusa' ? ' · Votazione chiusa' : ' · Voto aperto'}`
      : '';
  }

  function renderMain() {
    const { election, round, stats } = state;
    if (round.status === 'bozza') {
      return [
        h('h1', { class: 'screen-title' }, election.title),
        h('p', { class: 'screen-sub' }, round.label + (round.note ? ` — ${round.note}` : '')),
        h('p', { class: 'screen-wait' }, 'In attesa di apertura del voto'),
        h('p', { class: 'screen-sub' }, `Durata del voto: ${Math.round(election.durationSec / 60)} minuti`),
        state.localhostWarning
          ? h('p', { class: 'screen-warn' }, 'Attenzione: il pannello è aperto con «localhost», quindi il QR code non funzionerà dai telefoni. Aprilo con l\'indirizzo IP del computer.')
          : null,
      ];
    }
    if (round.status === 'aperta') {
      const left = round.endsAt - (Date.now() + offset);
      return [
        h(
          'div',
          { class: 'screen-open' },
          (() => {
            const box = h('div', { class: 'qr' });
            box.innerHTML = state.qrSvg; // SVG generato dal server
            return box;
          })(),
          h(
            'div',
            { class: 'screen-instr' },
            h(
              'div',
              { class: `timer-box${left < 60_000 ? ' urgent' : ''}`, id: 'timer-box' },
              h('span', {}, 'Tempo rimasto'),
              h('div', { class: 'screen-timer', id: 'timer' }, fmt(left)),
            ),
            h('p', { class: 'screen-step' }, h('b', {}, 'Inquadra il QR code'), ' con il telefono, oppure apri'),
            // a capo solo dopo una «/», mai a metà del codice della votazione
            h('p', {}, h('span', { class: 'screen-url' }, state.voteUrlShort.split('/').flatMap((part, i) => (i ? [h('wbr'), `/${part}`] : [part])))),
            h('p', { class: 'screen-step' }, 'e inserisci il tuo ', h('b', {}, 'codice di voto')),
            h(
              'div',
              { class: 'count-box' },
              h('span', {}, 'Voti ricevuti'),
              h('strong', {}, h('b', { id: 'count-used' }, String(stats.used)), h('small', {}, ` su ${stats.emitted}`)),
            ),
            round.extended ? h('p', { class: 'screen-warn' }, 'Voto prorogato di 2 minuti') : null,
          ),
        ),
      ];
    }
    // chiusa
    if (!state.results) {
      return [
        h('h1', { class: 'screen-title' }, election.title),
        h('p', { class: 'screen-wait' }, `${round.label}: votazione chiusa`),
        h('p', { class: 'screen-sub' }, `Voti ricevuti: ${stats.used}`),
      ];
    }
    const r = state.results;
    return [
      h(
        'div',
        { class: 'screen-results' },
        r.questions.map((q) => {
          if (q.kind === 'quesito') return motionResult(q);
          const max = Math.max(1, ...q.ranking.map((x) => x.total));
          return h(
            'section',
            { class: 'res-q' },
            h('h2', {}, q.title),
            h(
              'ol',
              { class: 'bars' },
              q.ranking.map((x) => {
                const elected = q.elected.includes(x.name);
                const tie = q.tie?.names.includes(x.name);
                const bar = h('span', { class: 'bar-fill' });
                bar.style.width = `${(x.total / max) * 100}%`;
                return h(
                  'li',
                  { class: `bar${elected ? ' elected' : ''}${tie ? ' tie' : ''}` },
                  h(
                    'span',
                    { class: 'bar-name' },
                    x.name,
                    elected ? h('span', { class: 'bar-tag' }, 'Eletto/a') : null,
                    tie ? h('span', { class: 'bar-tag' }, 'Parità') : null,
                  ),
                  h('span', { class: 'bar-track' }, bar),
                  h('span', { class: 'bar-num' }, String(x.total)),
                );
              }),
            ),
            h('p', { class: 'res-meta' }, h('span', {}, 'Schede bianche '), String(q.blank + (q.paper?.bianche ?? 0))),
            q.tie
              ? h('p', { class: 'screen-warn' }, `Parità all'ultimo posto tra ${q.tie.names.join(', ')}: si va al ballottaggio`)
              : h('p', { class: 'res-meta' }, h('span', {}, 'Eletti '), q.elected.join(', ') || '—'),
          );
        }),
      ),
      h(
        'p',
        { class: `res-foot${r.reconciled ? '' : ' bad'}` },
        `Schede ${r.totalBallots} · Astenuti ${r.abstained} · Codici usati ${r.usedCodes} · `,
        h('strong', {}, r.reconciled ? 'Riconciliazione corretta' : 'Riconciliazione NON corretta'),
      ),
    ];
  }

  // Quesito: barre in proporzione ai votanti, con il segno della maggioranza richiesta (metà + 1).
  function motionResult(q) {
    const m = q.motion;
    const scale = Math.max(1, m.votanti);
    return h(
      'section',
      { class: `res-q motion ${m.approvato ? 'yes' : 'no'}` },
      h('h2', {}, q.title),
      h(
        'ol',
        { class: 'bars' },
        q.ranking.map((x, i) => {
          const bar = h('span', { class: 'bar-fill' });
          bar.style.width = `${(x.total / scale) * 100}%`;
          const track = h('span', { class: 'bar-track' }, bar);
          if (i === 0) {
            const mark = h('span', { class: 'bar-mark', title: `Maggioranza: ${m.maggioranza}` });
            mark.style.left = `${Math.min(100, (m.maggioranza / scale) * 100)}%`;
            track.append(mark);
          }
          return h('li', { class: `bar${i === 0 ? ' fav' : ''}` }, h('span', { class: 'bar-name' }, x.name), track, h('span', { class: 'bar-num' }, String(x.total)));
        }),
      ),
      h(
        'div',
        { class: 'motion-foot' },
        h('p', { class: 'motion-verdict' }, m.approvato ? 'Approvato' : 'Respinto'),
        h(
          'p',
          { class: 'res-meta' },
          h('span', {}, 'Votanti '),
          String(m.votanti),
          h('span', {}, ' · servono '),
          `${m.maggioranza} favorevoli`,
          h('span', {}, ' · schede bianche '),
          String(q.blank + (q.paper?.bianche ?? 0)),
        ),
      ),
    );
  }

  function renderControls() {
    const { round } = state;
    const items = [];
    if (round.status === 'bozza') {
      items.push(
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => act('apri', {}, `Iniziare la votazione? Partono ${Math.round(state.election.durationSec / 60)} minuti.`),
          },
          'Inizia votazione',
        ),
      );
    }
    if (round.status === 'aperta') {
      if (!round.extended) items.push(h('button', { class: 'btn', onclick: () => act('proroga', {}, 'Prorogare di 2 minuti? Si può fare una sola volta.') }, 'Proroga +2 min'));
      items.push(h('button', { class: 'btn danger', onclick: () => act('chiudi', {}, 'Chiudere il voto adesso?') }, 'Chiudi ora'));
    }
    if (round.status === 'chiusa') {
      items.push(
        h(
          'button',
          { class: 'btn', onclick: () => act('risultati/visibilita', { hidden: !round.resultsHidden }) },
          round.resultsHidden ? 'Mostra risultati' : 'Nascondi risultati',
        ),
      );
      for (const t of state.ties ?? []) {
        items.push(
          h(
            'button',
            { class: 'btn primary', onclick: () => act('ballottaggio', { round: t.round, question: t.id }, `Preparare il ballottaggio per «${t.title}» tra ${t.names.join(', ')}?`) },
            `Prepara ballottaggio: ${t.title}`,
          ),
        );
      }
    }
    items.push(
      h(
        'button',
        {
          class: 'btn',
          onclick: () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()),
        },
        'Schermo intero',
      ),
    );
    items.push(h('a', { class: 'btn', href: `/admin/v/${id}` }, 'Pannello'));
    if (errorMsg) items.push(h('span', { class: 'ctrl-error' }, errorMsg));
    items.push(h('span', { class: 'ctrl-hint' }, 'Tasto H: nascondi i comandi'));
    return items;
  }

  function render() {
    const sig = JSON.stringify([state.round, !!state.results, state.results?.questions, state.ties, state.voteUrl, errorMsg, state.stats.emitted]);
    if (sig !== signature) {
      signature = sig;
      renderHead();
      main.replaceChildren(...renderMain().flat().filter(Boolean));
      controls.replaceChildren(...renderControls());
    }
    const t = document.getElementById('timer');
    if (t && state.round.status === 'aperta') {
      const left = state.round.endsAt - (Date.now() + offset);
      t.textContent = fmt(left);
      document.getElementById('timer-box').classList.toggle('urgent', left < 60_000);
    }
    const c = document.getElementById('count-used');
    if (c) c.textContent = String(state.stats.used);
  }

  async function poll() {
    try {
      const res = await fetch(`/admin/api/v/${id}/stato`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (res.status === 401) {
        location.href = '/admin/login';
        return;
      }
      if (!res.ok) throw new Error();
      state = await res.json();
      offset = state.serverNow - Date.now();
      render();
    } catch {
      /* rete momentaneamente assente: si riprova al prossimo giro */
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'h' || e.key === 'H') controls.classList.toggle('hidden');
  });

  setInterval(() => state && render(), 250);
  setInterval(poll, 1000);
  poll();
})();
