// Pagine del pannello di amministrazione.
import { html, raw } from '../lib/html.js';
import { roundLabel } from '../services/elections.js';
import { formatDay, parseDay } from '../lib/dates.js';

const STATUS = { bozza: 'In preparazione', aperta: 'Voto aperto', chiusa: 'Chiusa' };
const CODE_STATUS = { nessuno: 'Da inviare', email: 'Inviato via email', stampato: 'Stampato', errore: 'Errore di invio' };

const fmtDateTime = (ms) =>
  ms ? new Date(ms).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'medium' }) : '';

export function badge(status) {
  return html`<span class="badge ${status}">${STATUS[status] ?? status}</span>`;
}

export function loginPage({ error } = {}) {
  return html`<section class="card narrow">
  <h1>Accesso amministratori</h1>
  ${error ? html`<div class="flash error" role="alert">${error}</div>` : ''}
  <form method="post" action="/admin/login" class="stack">
    <label>Nome utente <input name="username" autocomplete="username" required autofocus></label>
    <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
    <button class="btn primary">Entra</button>
  </form>
</section>`;
}

export function totpPage({ error } = {}) {
  return html`<section class="card narrow">
  <h1>Verifica a due fattori</h1>
  <p>Inserisci il codice a 6 cifre dell'app di autenticazione.</p>
  ${error ? html`<div class="flash error" role="alert">${error}</div>` : ''}
  <form method="post" action="/admin/2fa" class="stack">
    <input name="token" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]*" maxlength="7" required autofocus class="code-input">
    <button class="btn primary">Verifica</button>
  </form>
</section>`;
}

export function totpSetupPage({ secret, qrSvg, required, error }) {
  return html`<section class="card narrow">
  <h1>Attiva la verifica a due fattori</h1>
  ${required ? html`<p><strong>Obbligatoria</strong> per accedere al pannello.</p>` : ''}
  <ol>
    <li>Apri sul telefono un'app di autenticazione (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
    <li>Inquadra questo QR code, oppure inserisci a mano la chiave: <code class="secret">${secret}</code></li>
    <li>Scrivi qui sotto il codice a 6 cifre che compare nell'app.</li>
  </ol>
  <div class="qr-small">${raw(qrSvg)}</div>
  ${error ? html`<div class="flash error" role="alert">${error}</div>` : ''}
  <form method="post" action="/admin/2fa/attiva" class="stack">
    <input type="hidden" name="secret" value="${secret}">
    <input name="token" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required class="code-input">
    <button class="btn primary">Attiva</button>
  </form>
</section>`;
}

export function dashboardPage({ elections }) {
  return html`<h1>Votazioni</h1>
<section class="card">
  <h2>Nuova votazione</h2>
  <form method="post" action="/admin/votazioni" class="grid-form">
    <label class="wide">Titolo <input name="title" required placeholder="Assemblea ordinaria – Elezione del Consiglio Direttivo"></label>
    <label>Data dell'assemblea <input name="assemblyDate" type="date" required></label>
    <label>Durata del voto (minuti) <input name="durationMin" type="number" min="1" max="60" value="5" required></label>
    <div class="wide"><button class="btn primary">Crea votazione</button></div>
  </form>
</section>
<section class="card">
  <h2>Elenco</h2>
  ${elections.length
    ? html`<table class="table">
    <thead><tr><th>Titolo</th><th>Data</th><th>Stato</th></tr></thead>
    <tbody>${elections.map(
      (e) => html`<tr><td><a href="/admin/v/${e.id}">${e.title}</a></td><td>${formatDay(e.assembly_date)}</td><td>${badge(e.status)}</td></tr>`,
    )}</tbody></table>`
    : html`<p class="muted">Nessuna votazione ancora.</p>`}
</section>`;
}

function questionCard(q, editable) {
  return html`<div class="question-admin">
  <div class="q-head">
    <h3>${q.title}</h3>
    <p class="muted">${q.seats} ${q.seats === 1 ? 'posto' : 'posti'} · fino a ${q.max_prefs} ${q.max_prefs === 1 ? 'preferenza' : 'preferenze'}${q.allow_write_in ? ' · si possono votare anche altri associati eleggibili' : ''}</p>
  </div>
  <ul class="cand-list">
    ${q.candidates.map(
      (c) => html`<li><span>${c.name}</span>${editable
        ? html`<form method="post" action="/admin/candidati/${c.id}/elimina"><button class="link danger" title="Togli ${c.name}">Togli</button></form>`
        : ''}</li>`,
    )}
    ${q.candidates.length ? '' : html`<li class="muted">Nessun candidato.</li>`}
  </ul>
  ${editable
    ? html`<form method="post" action="/admin/domande/${q.id}/candidati" class="inline-form">
      <input name="name" placeholder="Nome e cognome del candidato" required list="eligibles">
      <button class="btn">Aggiungi candidato</button>
    </form>
    <details>
      <summary>Modifica o elimina la domanda</summary>
      <form method="post" action="/admin/domande/${q.id}" class="grid-form">
        <label class="wide">Titolo <input name="title" value="${q.title}" required></label>
        <label>Posti da assegnare <input name="seats" type="number" min="1" max="20" value="${q.seats}" required></label>
        <label>Preferenze massime <input name="maxPrefs" type="number" min="1" max="20" value="${q.max_prefs}" required></label>
        <label class="check wide"><input type="checkbox" name="allowWriteIn" value="1" ${q.allow_write_in ? 'checked' : ''}> Si possono votare anche altri associati eleggibili (ricerca per nome)</label>
        <div class="wide"><button class="btn">Salva domanda</button></div>
      </form>
      <form method="post" action="/admin/domande/${q.id}/elimina" data-confirm="Eliminare la domanda «${q.title}» e i suoi candidati?">
        <button class="btn danger">Elimina domanda</button>
      </form>
    </details>`
    : ''}
</div>`;
}

function importReport(r) {
  return html`<section class="card report" role="status">
  <h2>${r.title}</h2>
  <p>${r.intro}</p>
  ${r.groups
    .filter((g) => g.items.length)
    .map((g) => html`<details open><summary>${g.label}</summary><ul class="small">${g.items.map((i) => html`<li>${i}</li>`)}</ul></details>`)}
</section>`;
}

export function electionPage(d) {
  const { election: e, current, rounds, questions, voters, eligibles, stats, editable, log, mailConfigured, canIssue } = d;
  const pendingEmail = voters.filter((v) => v.email && ['nessuno', 'errore'].includes(v.code_status)).length;
  const pendingPrint = voters.filter((v) => !v.email && v.code_status === 'nessuno').length;
  const count = (s) => voters.filter((v) => v.code_status === s).length;
  const anyClosed = rounds.some((r) => r.status === 'chiusa');
  // Stato dei 5 passi: fatto, da fare ora (il primo non fatto), da fare.
  const done = [
    null,
    !!parseDay(e.assembly_date),
    questions.length > 0 && questions.every((q) => q.candidates.length || q.allow_write_in),
    eligibles.length > 0,
    stats.emitted > 0,
    anyClosed,
  ];
  const firstTodo = done.findIndex((x, i) => i > 0 && !x);
  const steps = done.map((x, i) =>
    x ? { cls: 'is-done', label: 'Fatto', current: false } : i === firstTodo ? { cls: 'is-current', label: 'Da fare ora', current: true } : { cls: '', label: '', current: false },
  );

  return html`<p class="back"><a href="/admin">Tutte le votazioni</a></p>
<div class="page-head">
  <div>
    <h1>${e.title}</h1>
    <p class="muted">${badge(current.status)} <span>${formatDay(e.assembly_date)} · ${roundLabel(current)}</span></p>
  </div>
  <div class="head-actions">
    <a class="btn primary" href="/admin/v/${e.id}/schermo" target="_blank" rel="noopener">Apri lo schermo da proiettare</a>
    ${anyClosed ? html`<a class="btn" href="/admin/v/${e.id}/risultati">Risultati e verbale</a>` : ''}
  </div>
</div>

${d.report ? importReport(d.report) : ''}
<section class="card${steps[1].current ? ' is-current' : ''}">
  <h2 class="step-title"><span class="step ${steps[1].cls}" aria-hidden="true">1</span>Impostazioni<span class="step-state">${steps[1].label}</span></h2>
  ${editable
    ? html`<form method="post" action="/admin/v/${e.id}/impostazioni" class="grid-form">
    <label class="wide">Titolo <input name="title" value="${e.title}" required></label>
    <label>Data dell'assemblea <input name="assemblyDate" type="date" value="${parseDay(e.assembly_date)}" required></label>
    <label>Durata del voto (minuti) <input name="durationMin" type="number" min="1" max="60" value="${e.duration_sec / 60}" required></label>
    <div class="wide"><button class="btn">Salva impostazioni</button></div>
  </form>`
    : html`<p>Durata del voto: <strong>${e.duration_sec / 60} minuti</strong> (proroga possibile una volta, +2 minuti).</p>`}
</section>

<section class="card${steps[2].current ? ' is-current' : ''}">
  <h2 class="step-title"><span class="step ${steps[2].cls}" aria-hidden="true">2</span>Scheda di voto<span class="step-state">${steps[2].label}</span></h2>
  ${editable
    ? html`<p class="muted">Una votazione può avere una o più domande. Esempi: una sola domanda «Consiglio Direttivo» con 3 posti e fino a 3 preferenze; oppure tre domande «Presidente», «Vicepresidente», «Segretario» con 1 posto e 1 preferenza ciascuna.</p>`
    : html`<p class="muted">La votazione è stata aperta: la scheda non è più modificabile.</p>`}
  ${questions.map((q) => questionCard(q, editable))}
  ${editable
    ? html`<details ${questions.length ? '' : 'open'} class="add-question">
    <summary>+ Aggiungi una domanda</summary>
    <form method="post" action="/admin/v/${e.id}/domande" class="grid-form">
      <label class="wide">Titolo <input name="title" required value="${questions.length ? '' : 'Consiglio Direttivo'}"></label>
      <label>Posti da assegnare <input name="seats" type="number" min="1" max="20" value="${questions.length ? 1 : 3}" required></label>
      <label>Preferenze massime <input name="maxPrefs" type="number" min="1" max="20" value="${questions.length ? 1 : 3}" required></label>
      <label class="check wide"><input type="checkbox" name="allowWriteIn" value="1" ${questions.length ? '' : 'checked'}> Si possono votare anche altri associati eleggibili (ricerca per nome)</label>
      <div class="wide"><button class="btn primary">Aggiungi domanda</button></div>
    </form>
  </details>`
    : ''}
  <datalist id="eligibles">${eligibles.map((n) => html`<option value="${n}">`)}</datalist>
</section>

<section class="card${steps[3].current ? ' is-current' : ''}">
  <h2 class="step-title"><span class="step ${steps[3].cls}" aria-hidden="true">3</span>Eleggibili<span class="step-state">${steps[3].label}</span></h2>
  <p class="muted">Carica l'<strong>export completo dell'anagrafica soci</strong> (file Excel <code>.xlsx</code> o CSV, con le colonne
    <code>Codice</code>, <code>Nome</code>, <code>Cognome</code>, <code>Data Nascita</code>, <code>Scad. Tessera</code>, <code>Email</code>…).
    Sono eleggibili i soci attivi, maggiorenni e con la tessera valida alla data dell'assemblea. Gli eleggibili si possono cercare per nome nella scheda.
    <a href="/static/esempio-elenco.csv" download>Scarica un file di esempio</a>.</p>
  <div class="stats">
    <div><strong>${eligibles.length}</strong><span>eleggibili</span></div>
  </div>
  ${editable
    ? html`<form method="post" action="/admin/v/${e.id}/eleggibili" class="stack" data-upload>
    <label>Anagrafica completa <input type="file" accept=".xlsx,.csv,text/csv" required></label>
    <input type="hidden" name="xlsx"><input type="hidden" name="csv">
    <button class="btn ${eligibles.length ? '' : 'primary'}">${eligibles.length ? 'Reimporta (sostituisce l\'elenco attuale)' : 'Importa eleggibili'}</button>
  </form>`
    : ''}
  ${eligibles.length
    ? html`<details>
    <summary>Elenco degli eleggibili (${eligibles.length})</summary>
    <ul class="eligible-list">${eligibles.map((n) => html`<li>${n}</li>`)}</ul>
  </details>`
    : ''}
</section>

<section class="card${steps[4].current ? ' is-current' : ''}">
  <h2 class="step-title"><span class="step ${steps[4].cls}" aria-hidden="true">4</span>Aventi diritto e codici<span class="step-state">${steps[4].label}</span></h2>
  <div class="stats">
    <div><strong>${voters.length}</strong><span>aventi diritto</span></div>
    <div><strong>${stats.emitted}</strong><span>codici validi</span></div>
    <div><strong>${count('email')}</strong><span>inviati via email</span></div>
    <div><strong>${count('stampato')}</strong><span>stampati</span></div>
    <div class="${count('errore') ? 'warn' : ''}"><strong>${count('errore')}</strong><span>errori di invio</span></div>
  </div>

  ${canIssue
    ? html`<p class="muted">Il giorno dell'assemblea carica l'<strong>anagrafica filtrata sui presenti</strong> (in sala e su Meet), nello stesso formato.
    Valgono gli stessi criteri. Puoi ricaricare il file aggiornato quando arriva qualcuno: vengono aggiunti solo i soci nuovi, gli altri mantengono il loro codice.</p>
  <form method="post" action="/admin/v/${e.id}/presenti" class="stack" data-upload>
    <label>Anagrafica dei presenti <input type="file" accept=".xlsx,.csv,text/csv" required></label>
    <input type="hidden" name="xlsx"><input type="hidden" name="csv">
    <button class="btn ${voters.length ? '' : 'primary'}">${voters.length ? 'Aggiungi i presenti da un file aggiornato' : 'Importa i presenti'}</button>
  </form>`
    : ''}

  ${canIssue && voters.length
    ? html`<div class="button-row">
    <form method="post" action="/admin/v/${e.id}/codici/email" data-confirm="Inviare ${pendingEmail} email con i codici di voto?">
      <button class="btn primary" ${pendingEmail && mailConfigured ? '' : 'disabled'}>Invia i codici via email (${pendingEmail})</button>
    </form>
    <form method="post" action="/admin/v/${e.id}/codici/stampa" target="_blank">
      <button class="btn" ${pendingPrint ? '' : 'disabled'}>Stampa cartellini per chi non ha email (${pendingPrint})</button>
    </form>
  </div>
  ${mailConfigured ? '' : html`<p class="flash error">Server email non configurato: imposta SMTP_HOST nel file .env per inviare i codici.</p>`}
  <p class="muted small">Consiglio: invia le email 10–15 minuti prima dell'apertura. Il codice funziona solo mentre il voto è aperto. Alla chiusura del primo turno il legame socio–codice viene cancellato.</p>`
    : ''}

  ${voters.length
    ? html`<details>
    <summary>Elenco degli aventi diritto (${voters.length})</summary>
    <div class="table-scroll"><table class="table compact">
      <thead><tr><th>Nome</th><th>Email</th><th>Gruppo</th><th>Codice</th><th></th></tr></thead>
      <tbody>${voters.map(
        (v) => html`<tr>
        <td>${v.cognome} ${v.nome}${v.tipologia === 'minore' ? html` <span class="pill">minore</span>` : ''}</td>
        <td>${canIssue
          ? html`<form method="post" action="/admin/v/${e.id}/soci/${v.id}/email" class="inline-form tight"><input name="email" type="email" value="${v.email}" placeholder="nessuna"><button class="link">Salva</button></form>`
          : v.email}</td>
        <td>${v.categoria}</td>
        <td><span class="pill ${v.code_status}">${CODE_STATUS[v.code_status] ?? v.code_status}</span></td>
        <td class="nowrap">${canIssue
          ? html`${v.email
              ? html`<form method="post" action="/admin/v/${e.id}/soci/${v.id}/reinvia" data-confirm="Generare un nuovo codice per ${v.nome} ${v.cognome} e inviarlo a ${v.email}? Il codice precedente non sarà più valido."><button class="link">${v.code_status === 'nessuno' ? 'Invia' : 'Nuovo codice'}</button></form>`
              : ''}
            <form method="post" action="/admin/v/${e.id}/soci/${v.id}/stampa" target="_blank" ${v.code_status !== 'nessuno' ? html`data-confirm="Generare un nuovo codice da stampare per ${v.nome} ${v.cognome}? Il codice precedente non sarà più valido."` : ''}><button class="link">Stampa</button></form>`
          : ''}</td>
      </tr>`,
      )}</tbody>
    </table></div>
  </details>`
    : ''}

  ${canIssue
    ? html`<details>
    <summary>Aggiungi a mano un avente diritto</summary>
    <form method="post" action="/admin/v/${e.id}/soci" class="grid-form">
      <label>Nome <input name="nome" required></label>
      <label>Cognome <input name="cognome" required></label>
      <label>Email <input name="email" type="email"></label>
      <p class="muted small wide">Solo per un socio con diritto di voto che manca nel file dei presenti: i criteri qui non vengono controllati.</p>
      <div class="wide"><button class="btn">Aggiungi</button></div>
    </form>
  </details>`
    : ''}
  ${voters.length && editable
    ? html`<form method="post" action="/admin/v/${e.id}/elenco/svuota" data-confirm="Svuotare l'elenco degli aventi diritto? Tutti i codici già distribuiti diventeranno non validi. Gli eleggibili restano." class="mt">
    <button class="btn danger small">Svuota aventi diritto e codici</button>
  </form>`
    : ''}
</section>

<section class="card${steps[5].current ? ' is-current' : ''}">
  <h2 class="step-title"><span class="step ${steps[5].cls}" aria-hidden="true">5</span>Votazione<span class="step-state">${steps[5].label}</span></h2>
  ${rounds.map(
    (r) => html`<div class="round-row">
    <div><strong>${roundLabel(r)}</strong> ${badge(r.status)} ${r.note ? html`<span class="muted">— ${r.note}</span>` : ''}
      ${r.opened_at ? html`<div class="muted small">Aperto: ${fmtDateTime(r.opened_at)}${r.closed_at ? html` · Chiuso: ${fmtDateTime(r.closed_at)}` : ''}${r.extended ? ' · prorogato' : ''}</div>` : ''}
    </div>
  </div>`,
  )}
  <p>Codici usati nel turno corrente: <strong>${stats.used}</strong> su ${stats.emitted}.</p>
  <div class="button-row">
    ${current.status === 'bozza'
      ? html`<form method="post" action="/admin/v/${e.id}/apri" data-confirm="Aprire il voto adesso? Partono ${e.duration_sec / 60} minuti."><button class="btn primary">Inizia votazione</button></form>`
      : ''}
    <a class="btn" href="/admin/v/${e.id}/schermo" target="_blank" rel="noopener">Apri lo schermo da proiettare</a>
    ${current.status === 'aperta' && !current.extended
      ? html`<form method="post" action="/admin/v/${e.id}/proroga" data-confirm="Prorogare il voto di 2 minuti? Si può fare una sola volta."><button class="btn">Proroga di 2 minuti</button></form>`
      : ''}
    ${current.status === 'aperta'
      ? html`<form method="post" action="/admin/v/${e.id}/chiudi" data-confirm="Chiudere il voto adesso, prima della scadenza?"><button class="btn danger">Chiudi ora</button></form>`
      : ''}
  </div>
  <p class="muted small">Puoi aprire e gestire il voto anche direttamente dallo schermo da proiettare.</p>
</section>

<section class="card">
  <h2>Registro delle operazioni</h2>
  ${log.length
    ? html`<ul class="log">${log.map((l) => html`<li><span class="muted">${fmtDateTime(l.at)}</span> · ${l.username} · ${l.action}</li>`)}</ul>`
    : html`<p class="muted">Nessuna operazione.</p>`}
</section>

<section class="card danger-zone">
  <h2>Zona pericolosa</h2>
  <div class="button-row">
    ${anyClosed && current.status !== 'aperta'
      ? html`<form method="post" action="/admin/v/${e.id}/dati-personali/elimina" data-confirm="Cancellare nomi ed email degli aventi diritto? Restano i risultati e il registro. Operazione irreversibile."><button class="btn danger">Cancella i dati personali (dopo l'assemblea)</button></form>`
      : ''}
    ${current.status !== 'aperta'
      ? html`<form method="post" action="/admin/v/${e.id}/elimina" data-confirm="Eliminare definitivamente la votazione «${e.title}» con tutti i dati e i risultati?"><button class="btn danger">Elimina votazione</button></form>`
      : ''}
  </div>
</section>`;
}

export function printCardsPage({ election, cards }) {
  return html`<div class="no-print card">
  <h1>Cartellini con i codici (${cards.length})</h1>
  <p><strong>Stampa ora:</strong> i codici non vengono salvati e non saranno più visibili dopo aver chiuso questa pagina. Se la perdi, dovrai generare nuovi codici.</p>
  <button class="btn primary" data-print>Stampa</button>
</div>
<div class="cards">
  ${cards.map(
    (c) => html`<div class="code-card">
    <div class="cc-head"><img src="/static/simbolo-magnetico.svg" alt="" width="22" height="22"><span class="cc-title">${election.title}</span></div>
    <div class="cc-name">${c.name}${c.minore ? ' (minorenne – consegnare al genitore)' : ''}</div>
    <div class="cc-code">${c.code}</div>
    <div class="cc-help">All'apertura del voto inquadra il QR code sullo schermo dell'assemblea e inserisci questo codice. Vale una volta per ogni turno. Non mostrarlo a nessuno.</div>
  </div>`,
  )}
</div>`;
}

export function screenPage({ election }) {
  return html`<div id="screen" data-id="${election.id}">
  <header class="screen-head">
    <img class="logo" src="/static/logo-magnetico.webp" alt="Magnetico — Costruiamo competenze, ispiriamo opportunità" width="2000" height="775">
    <div class="screen-head-text"><div class="screen-head-title" id="screen-head-title"></div><div class="screen-head-sub" id="screen-head-sub"></div></div>
  </header>
  <div class="screen-main" id="screen-main"><p class="screen-wait">Caricamento…</p></div>
  <div class="screen-controls" id="screen-controls"></div>
</div>`;
}

function resultsTable(q) {
  const hasPaper = !!q.paper;
  return html`<table class="table results">
  <thead><tr><th>Nome</th><th class="num">Online</th>${hasPaper ? html`<th class="num">Cartacee</th><th class="num">Totale</th>` : ''}<th>Esito</th></tr></thead>
  <tbody>
    ${q.ranking.map(
      (r) => html`<tr class="${q.elected.includes(r.name) ? 'elected' : ''}">
      <td>${r.name}${r.listed ? '' : html` <span class="pill">fuori lista</span>`}</td>
      <td class="num">${r.online}</td>
      ${hasPaper ? html`<td class="num">${r.paper}</td><td class="num"><strong>${r.total}</strong></td>` : ''}
      <td>${q.elected.includes(r.name) ? 'Eletto/a' : q.tie?.names.includes(r.name) ? 'Parità' : ''}</td>
    </tr>`,
    )}
    <tr class="sep"><td>Schede bianche</td><td class="num">${q.blank}</td>${hasPaper ? html`<td class="num">${q.paper.bianche}</td><td class="num">${q.blank + q.paper.bianche}</td>` : ''}<td></td></tr>
    ${hasPaper ? html`<tr><td>Schede nulle (cartacee)</td><td class="num">–</td><td class="num">${q.paper.nulle}</td><td class="num">${q.paper.nulle}</td><td></td></tr>` : ''}
  </tbody>
</table>`;
}

export function resultsPage({ election, rounds, pending = new Set(), canRunoff = false }) {
  return html`<p class="no-print back"><a href="/admin/v/${election.id}">Torna alla votazione</a></p>
<div class="page-head">
  <div>
    <h1>Risultati — ${election.title}</h1>
    <p class="muted">${formatDay(election.assembly_date)}</p>
  </div>
  <div class="head-actions no-print">
    <a class="btn" href="/admin/v/${election.id}/risultati.csv">Scarica CSV</a>
    <button class="btn primary" data-print>Stampa / Salva PDF</button>
  </div>
</div>
${rounds.map(
  ({ round, result }) => html`<section class="card round-result">
  <h2>${roundLabel(round)} ${round.note ? html`<span class="muted small">— ${round.note}</span>` : ''}</h2>
  <p class="muted small">Aperto: ${fmtDateTime(round.opened_at)} · Chiuso: ${fmtDateTime(round.closed_at)}${round.extended ? ' · con proroga di 2 minuti' : ''}</p>
  <div class="stats">
    <div><strong>${result.totalBallots}</strong><span>schede online</span></div>
    <div><strong>${result.abstained}</strong><span>astenuti</span></div>
    <div><strong>${result.usedCodes}</strong><span>codici usati</span></div>
    <div class="${result.reconciled ? 'good' : 'warn'}"><strong>${result.reconciled ? 'Corretta' : 'Errata'}</strong><span>riconciliazione codici / schede</span></div>
  </div>
  ${result.questions.map(
    (q) => html`<div class="q-result">
    <h3>${q.title}</h3>
    <p class="muted small">${q.seats} ${q.seats === 1 ? 'posto' : 'posti'} · fino a ${q.maxPrefs} ${q.maxPrefs === 1 ? 'preferenza' : 'preferenze'}${q.paper ? html` · schede cartacee: ${q.paper.schede}` : ''}</p>
    ${resultsTable(q)}
    <p><strong>Eletti:</strong> ${q.elected.length ? q.elected.join(', ') : '—'}</p>
    ${q.tie
      ? html`<div class="flash error">Parità all'ultimo posto utile (${q.tie.votes} voti) tra: <strong>${q.tie.names.join(', ')}</strong> — ${q.tie.seatsLeft === 1 ? 'resta 1 posto' : `restano ${q.tie.seatsLeft} posti`}.
        ${pending.has(`${round.id}:${q.id}`)
          ? canRunoff
            ? html`<form method="post" action="/admin/v/${election.id}/ballottaggio" class="no-print inline-form"><input type="hidden" name="round" value="${round.id}"><input type="hidden" name="question" value="${q.id}"><button class="btn primary">Prepara il ballottaggio</button></form>`
            : html`<p class="no-print">Ballottaggio da preparare quando il turno in corso sarà chiuso.</p>`
          : ''}
        ${round.number > 1 ? html`<p>Parità anche al ballottaggio: si può ripetere il ballottaggio oppure procedere secondo la delibera del Consiglio Direttivo (es. sorteggio).</p>` : ''}
      </div>`
      : ''}
    ${round.status === 'chiusa' ? paperForm(election, round, q) : ''}
  </div>`,
  )}
</section>`,
)}`;
}

function paperForm(election, round, q) {
  const listed = q.ranking.filter((r) => r.listed);
  const others = q.ranking.filter((r) => !r.listed && r.paper > 0);
  return html`<details class="no-print paper">
  <summary>Piano B: inserisci i totali delle schede cartacee${q.paper ? ' (già inseriti — modifica)' : ''}</summary>
  <form method="post" action="/admin/v/${election.id}/turni/${round.id}/cartacee" class="grid-form">
    <input type="hidden" name="question" value="${q.id}">
    ${listed.map(
      (r) => html`<label>${r.name} <input type="number" min="0" name="v:${r.name}" value="${r.paper || ''}" placeholder="0"></label>`,
    )}
    <label class="wide">Altri nomi votati su carta (uno per riga: «Nome Cognome; voti»)
      <textarea name="others" rows="3">${others.map((r) => `${r.name}; ${r.paper}`).join('\n')}</textarea></label>
    <label>Schede bianche <input type="number" min="0" name="bianche" value="${q.paper?.bianche ?? ''}" placeholder="0"></label>
    <label>Schede nulle <input type="number" min="0" name="nulle" value="${q.paper?.nulle ?? ''}" placeholder="0"></label>
    <label>Totale schede cartacee <input type="number" min="0" name="schede" value="${q.paper?.schede ?? ''}" placeholder="0"></label>
    <div class="wide button-row"><button class="btn primary">Salva schede cartacee</button>
    ${q.paper ? html`<button class="btn danger" name="delete" value="1">Rimuovi</button>` : ''}</div>
  </form>
</details>`;
}
