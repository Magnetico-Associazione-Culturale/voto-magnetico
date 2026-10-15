import { html } from '../lib/html.js';

const LOGO = html`<img class="logo" src="/static/logo-magnetico.webp" alt="Magnetico — Costruiamo competenze, ispiriamo opportunità" width="2000" height="775">`;

export function layout({ title, body, admin = null, flash = null, bodyClass = '', scripts = [], version = 'dev' }) {
  const screen = bodyClass.includes('screen');
  return html`<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#EDEBDC">
<title>${title} · Magnetico</title>
<link rel="icon" href="/static/simbolo-magnetico.svg" type="image/svg+xml">
<link rel="preload" href="/static/montserrat-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/static/style.css">
</head>
<body class="${bodyClass}">
${admin
  ? html`<header class="topbar">
  <a class="brand" href="/admin" aria-label="Votazioni Magnetico: tutte le votazioni">${LOGO}<span class="brand-product">Votazioni</span></a>
  <span class="topbar-user">${admin.username}</span>
  <form method="post" action="/admin/logout"><button class="btn small">Esci</button></form>
</header>`
  : screen
    ? ''
    : html`<header class="brandbar">${LOGO}</header>`}
<main class="${admin ? 'admin' : ''}">
${flash?.ok ? html`<div class="flash ok" role="status">${flash.ok}</div>` : ''}
${flash?.error ? html`<div class="flash error" role="alert">${flash.error}</div>` : ''}
${body}
</main>
<footer class="foot">Piattaforma di voto Magnetico · versione ${version}</footer>
${scripts.map((s) => html`<script src="/static/${s}" defer></script>`)}
</body>
</html>`.toString();
}
