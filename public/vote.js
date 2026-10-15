// Pagina di voto (telefono). Nessun dato viene salvato sul dispositivo:
// il codice resta solo in memoria finché la pagina è aperta.
(() => {
  'use strict';
  const root = document.getElementById('app');
  const slug = root.dataset.slug;
  const api = (p) => `/api/v/${encodeURIComponent(slug)}${p}`;

  const state = {
    info: null,
    clockOffset: 0,
    code: '',
    ballot: null,
    order: {}, // ordine casuale dei candidati per ogni domanda
    picks: {}, // qid -> [{id?, name}]
    blank: {}, // qid -> true se lasciata esplicitamente in bianco
    abstain: false,
    nonce: null,
    screen: 'code',
    error: '',
    busy: false,
  };

  // --- utilità DOM (niente innerHTML con dati esterni) ---
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

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const r = new Uint32Array(1);
      crypto.getRandomValues(r);
      const j = r[0] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function newNonce() {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  }

  async function post(path, body) {
    const res = await fetch(api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* risposta vuota */
    }
    return { ok: res.ok, status: res.status, data };
  }

  // --- timer ---
  const now = () => Date.now() + state.clockOffset;
  function remaining() {
    return state.info ? Math.max(0, state.info.endsAt - now()) : 0;
  }
  function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function timerEl() {
    const r = remaining();
    return h('div', { class: `timer${r < 60_000 ? ' urgent' : ''}`, id: 'timer', 'aria-live': 'off' }, h('small', {}, 'Tempo rimasto'), h('span', { id: 'timer-val' }, fmt(r)));
  }
  // Aggiorna scadenza e stato dal server (es. dopo una proroga di 2 minuti).
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      const res = await fetch(api(''), { cache: 'no-store' });
      if (res.ok) {
        const info = await res.json();
        state.info = info;
        state.clockOffset = info.serverNow - Date.now();
      }
    } catch {
      /* rete assente: si riprova al prossimo giro */
    }
    refreshing = false;
  }
  // Solo nell'ultimo minuto e mezzo, per non caricare il server con richieste inutili.
  setInterval(() => {
    if (state.info && remaining() < 90_000 && state.screen !== 'done' && state.screen !== 'closed') refresh();
  }, 10_000);

  setInterval(async () => {
    const t = document.getElementById('timer');
    if (!state.info) return;
    if (remaining() <= 0 && ['code', 'ballot', 'summary'].includes(state.screen)) {
      // Prima di dichiarare chiuso, chiede al server: il voto potrebbe essere stato prorogato.
      await refresh();
      if (remaining() > 0 && state.info.status === 'aperta') return;
      state.screen = 'closed';
      render();
      return;
    }
    if (t) {
      t.querySelector('#timer-val').textContent = fmt(remaining());
      t.classList.toggle('urgent', remaining() < 60_000);
    }
  }, 500);

  // --- schermate ---
  function header() {
    return h('header', { class: 'vote-head' }, h('h1', {}, state.info.title), h('p', { class: 'muted' }, state.info.label), timerEl());
  }

  function errorBox() {
    return state.error ? h('div', { class: 'flash error', role: 'alert' }, state.error) : null;
  }

  function screenCode() {
    const input = h('input', {
      id: 'code',
      class: 'code-input',
      inputmode: 'text',
      autocomplete: 'off',
      autocapitalize: 'characters',
      spellcheck: 'false',
      maxlength: '20',
      placeholder: 'XXXX-XXXX-XXXX',
      'aria-label': 'Codice di voto',
      value: state.code,
    });
    const form = h(
      'form',
      {
        class: 'card',
        onsubmit: async (e) => {
          e.preventDefault();
          if (state.busy) return;
          state.code = input.value.trim();
          state.busy = true;
          state.error = '';
          render();
          try {
            const r = await post('/codice', { code: state.code });
            if (r.ok) {
              state.ballot = r.data.ballot;
              state.order = {};
              state.picks = {};
              state.blank = {};
              state.abstain = false;
              state.nonce = newNonce();
              for (const q of state.ballot.questions) {
                state.order[q.id] = shuffle(q.candidates);
                state.picks[q.id] = [];
              }
              state.screen = 'ballot';
            } else if (r.data.code === 'closed') state.screen = 'closed';
            else state.error = r.data.error || 'Codice non valido.';
          } catch {
            state.error = 'Connessione assente. Controlla la rete e riprova.';
          }
          state.busy = false;
          render();
        },
      },
      h('label', { for: 'code', class: 'big-label' }, 'Inserisci il tuo codice di voto'),
      h('p', { class: 'muted' }, 'Lo trovi nell\'email ricevuta o sul cartellino. Maiuscole e trattini non contano.'),
      input,
      errorBox(),
      h('button', { class: 'btn primary big', type: 'submit', disabled: state.busy }, state.busy ? 'Verifica…' : 'Continua'),
      h('p', { class: 'anon-note' }, 'Il voto è anonimo: il codice serve solo a impedire di votare due volte e non viene collegato alla tua scheda.'),
    );
    setTimeout(() => input.focus(), 0);
    return [header(), form];
  }

  function isChosen(qid, name) {
    return state.picks[qid].some((p) => p.name.toLowerCase() === name.toLowerCase());
  }

  function toggle(q, cand) {
    const list = state.picks[q.id];
    const i = list.findIndex((p) => p.name.toLowerCase() === cand.name.toLowerCase());
    if (i >= 0) list.splice(i, 1);
    else if (list.length < q.maxPrefs) {
      list.push(cand);
      state.blank[q.id] = false;
    }
    render();
  }

  function questionBlock(q) {
    const list = state.picks[q.id];
    const full = list.length >= q.maxPrefs;
    const block = h(
      'section',
      { class: 'card question' },
      h('h2', {}, q.title),
      h(
        'p',
        { class: 'muted' },
        q.maxPrefs === 1 ? 'Scegli 1 nome.' : `Scegli fino a ${q.maxPrefs} nomi (anche meno).`,
        ' Scelti ',
        h('span', { class: 'count' }, `${list.length}/${q.maxPrefs}`),
      ),
      h(
        'div',
        { class: 'choices' },
        state.order[q.id].map((c) => {
          const on = isChosen(q.id, c.name);
          return h(
            'button',
            {
              type: 'button',
              class: `choice${on ? ' on' : ''}`,
              'aria-pressed': on ? 'true' : 'false',
              disabled: !on && full,
              onclick: () => toggle(q, { id: c.id, name: c.name }),
            },
            h('span', { class: 'tick', 'aria-hidden': 'true' }),
            c.name,
          );
        }),
      ),
    );

    // Nomi scelti fuori lista (altri associati eleggibili)
    const extra = list.filter((p) => !p.id);
    if (extra.length) {
      block.append(
        h(
          'div',
          { class: 'choices' },
          extra.map((p) =>
            h(
              'button',
              { type: 'button', class: 'choice on', 'aria-pressed': 'true', onclick: () => toggle(q, p) },
              h('span', { class: 'tick', 'aria-hidden': 'true' }),
              p.name,
              h('span', { class: 'tag' }, 'fuori lista'),
            ),
          ),
        ),
      );
    }

    if (q.allowWriteIn && !full) block.append(searchBox(q));

    const blankOn = !!state.blank[q.id];
    block.append(
      h(
        'button',
        {
          type: 'button',
          class: `choice blank${blankOn ? ' on' : ''}`,
          'aria-pressed': blankOn ? 'true' : 'false',
          onclick: () => {
            state.blank[q.id] = !blankOn;
            if (state.blank[q.id]) state.picks[q.id] = [];
            render();
          },
        },
        h('span', { class: 'tick', 'aria-hidden': 'true' }),
        'Lascio in bianco',
      ),
    );
    return block;
  }

  function searchBox(q) {
    const results = h('div', { class: 'choices' });
    let timer;
    const input = h('input', {
      type: 'search',
      class: 'search',
      placeholder: 'Cerca per nome o cognome',
      'aria-label': 'Cerca un altro associato eleggibile',
      autocomplete: 'off',
      oninput: () => {
        clearTimeout(timer);
        timer = setTimeout(async () => {
          results.replaceChildren();
          const term = input.value.trim();
          if (term.length < 2) return;
          try {
            const r = await post('/cerca', { code: state.code, question: q.id, q: term });
            const names = (r.data.results || []).filter((n) => !isChosen(q.id, n));
            if (!names.length) results.append(h('p', { class: 'muted small' }, 'Nessun associato eleggibile trovato.'));
            for (const n of names) {
              results.append(
                h('button', { type: 'button', class: 'choice add', onclick: () => toggle(q, { name: n }) }, h('span', { class: 'tick', 'aria-hidden': 'true' }), n),
              );
            }
          } catch {
            results.append(h('p', { class: 'muted small' }, 'Ricerca non disponibile, riprova.'));
          }
        }, 250);
      },
    });
    return h('div', { class: 'search-box' }, h('p', { class: 'small' }, 'Puoi votare anche un associato eleggibile che non è in lista:'), input, results);
  }

  function screenBallot() {
    const qs = state.ballot.questions;
    const ready = qs.every((q) => state.picks[q.id].length > 0 || state.blank[q.id]);
    return [
      header(),
      qs.map(questionBlock),
      errorBox(),
      h(
        'div',
        { class: 'actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn primary big',
            disabled: !ready,
            onclick: () => {
              state.abstain = false;
              state.screen = 'summary';
              state.error = '';
              render();
            },
          },
          'Continua',
        ),
        !ready ? h('p', { class: 'muted small center' }, 'Per continuare scegli almeno un nome oppure «Lascio in bianco» in ogni domanda.') : null,
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost big',
            onclick: () => {
              state.abstain = true;
              state.screen = 'summary';
              state.error = '';
              render();
            },
          },
          'Mi astengo',
        ),
      ),
    ];
  }

  function screenSummary() {
    const items = state.abstain
      ? [h('section', { class: 'card' }, h('h2', {}, 'Ti astieni'), h('p', {}, 'La scheda verrà registrata come astensione.'))]
      : state.ballot.questions.map((q) =>
          h(
            'section',
            { class: 'card' },
            h('h2', {}, q.title),
            state.picks[q.id].length
              ? h('ul', { class: 'summary' }, state.picks[q.id].map((p) => h('li', {}, p.name)))
              : h('p', {}, h('strong', {}, 'Scheda bianca')),
          ),
        );
    return [
      header(),
      h('section', { class: 'card notice' }, h('h2', {}, 'Controlla il tuo voto'), h('p', {}, 'Dopo l\'invio non sarà più possibile modificarlo.')),
      items,
      errorBox(),
      h(
        'div',
        { class: 'actions' },
        h('button', { type: 'button', class: 'btn primary big', disabled: state.busy, onclick: submit }, state.busy ? 'Invio in corso…' : 'Conferma e invia il voto'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost big',
            disabled: state.busy,
            onclick: () => {
              state.screen = 'ballot';
              state.error = '';
              render();
            },
          },
          'Torna indietro e modifica',
        ),
      ),
    ];
  }

  async function submit() {
    if (state.busy) return;
    state.busy = true;
    state.error = '';
    render();
    const content = state.abstain
      ? { abstain: true }
      : {
          answers: Object.fromEntries(
            state.ballot.questions.map((q) => [q.id, { picks: state.picks[q.id].map((p) => (p.id ? { id: p.id } : { name: p.name })) }]),
          ),
        };
    try {
      const r = await post('/vota', { code: state.code, content, nonce: state.nonce });
      if (r.ok) {
        state.screen = 'done';
        // Dimentica tutto: nessuna traccia del voto resta nella pagina.
        state.code = '';
        state.ballot = null;
        state.picks = {};
        state.nonce = null;
      } else if (r.data.code === 'closed') state.screen = 'closed';
      else state.error = r.data.error || 'Errore durante l\'invio. Riprova.';
    } catch {
      // Rete persa: il voto potrebbe essere arrivato o no. Riprovando con lo stesso
      // identificativo, il server riconosce un eventuale voto già registrato.
      state.error = 'Connessione persa durante l\'invio. Tocca di nuovo «Conferma e invia»: se il voto era già arrivato, verrà solo confermato.';
    }
    state.busy = false;
    render();
  }

  function screenDone() {
    return [
      h(
        'section',
        { class: 'card center done' },
        h('div', { class: 'big-check', 'aria-hidden': 'true' }),
        h('h1', {}, 'Voto registrato'),
        h('p', {}, 'Grazie. Il tuo voto è stato registrato in forma anonima.'),
      ),
      h(
        'div',
        { class: 'actions' },
        h('p', { class: 'muted small center' }, 'Un altro socio deve votare da questo telefono?'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn ghost big',
            onclick: () => {
              state.screen = remaining() > 0 ? 'code' : 'closed';
              render();
            },
          },
          'Vota con un altro codice',
        ),
      ),
    ];
  }

  function screenClosed() {
    return h('section', { class: 'card center' }, h('h1', {}, 'Votazione chiusa'), h('p', {}, 'Il tempo per votare è terminato. I risultati saranno mostrati in assemblea.'));
  }

  function render() {
    let content;
    if (!state.info) content = h('section', { class: 'card center' }, h('p', {}, 'Caricamento…'));
    else if (state.screen === 'code') content = screenCode();
    else if (state.screen === 'ballot') content = screenBallot();
    else if (state.screen === 'summary') content = screenSummary();
    else if (state.screen === 'done') content = screenDone();
    else content = screenClosed();
    root.replaceChildren(...[content].flat(3).filter(Boolean));
  }

  async function load() {
    try {
      const res = await fetch(api(''), { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const info = await res.json();
      state.info = info;
      state.clockOffset = info.serverNow - Date.now();
      state.screen = info.status === 'aperta' && remaining() > 0 ? 'code' : 'closed';
    } catch {
      root.replaceChildren(h('section', { class: 'card center' }, h('h1', {}, 'Votazione non disponibile'), h('p', {}, 'Controlla l\'indirizzo o riprova tra poco.')));
      return;
    }
    render();
  }

  load();
})();
