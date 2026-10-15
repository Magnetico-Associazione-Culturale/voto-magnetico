// Piccoli aiuti per il pannello: conferme, lettura dell'anagrafica (Excel o CSV), stampa.
(() => {
  'use strict';
  document.addEventListener('submit', (e) => {
    const msg = e.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Caricamento dell'anagrafica: il file Excel viaggia in base64, il CSV come testo.
  for (const form of document.querySelectorAll('form[data-upload]')) {
    const input = form.querySelector('input[type=file]');
    input.addEventListener('change', async () => {
      form.elements.xlsx.value = '';
      form.elements.csv.value = '';
      const f = input.files[0];
      if (!f) return;
      const buf = new Uint8Array(await f.arrayBuffer());
      if (/\.xlsx$/i.test(f.name) || (buf[0] === 0x50 && buf[1] === 0x4b)) {
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        form.elements.xlsx.value = btoa(bin);
      } else {
        // Prova UTF-8; se ci sono caratteri non validi, usa la codifica di Excel (Windows-1252).
        let content = new TextDecoder('utf-8').decode(buf);
        if (content.includes('\uFFFD')) content = new TextDecoder('windows-1252').decode(buf);
        form.elements.csv.value = content;
      }
    });
    // Il file si legge in modo asincrono: non inviare prima che sia pronto.
    form.addEventListener('submit', (e) => {
      if (!form.elements.xlsx.value && !form.elements.csv.value) {
        e.preventDefault();
        window.alert('Attendi il caricamento del file e riprova.');
      }
    });
  }

  for (const b of document.querySelectorAll('[data-print]')) b.addEventListener('click', () => window.print());
})();
