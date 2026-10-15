# Sicurezza

## Segnalare una vulnerabilità

Se trovi un problema che potrebbe compromettere l'anonimato, l'integrità del voto o l'accesso al pannello, **non aprire una issue pubblica**.

Scrivi invece in privato usando la funzione **[Report a vulnerability](https://github.com/Magnetico-Associazione-Culturale/voto-magnetico/security/advisories/new)** di GitHub, oppure contatta direttamente i responsabili dell'associazione.

Indica:
- cosa hai trovato e come riprodurlo;
- quale versione (in fondo a ogni pagina);
- l'impatto che ritieni possibile.

Rispondiamo il prima possibile. Nei giorni che precedono un'assemblea la priorità è massima.

## Versioni supportate

Viene mantenuta solo l'ultima versione pubblicata.

## Revisione del codice

Prima di ogni assemblea si raccomanda una revisione indipendente del codice della versione da installare. I punti da verificare sono [`src/db.js`](src/db.js) (struttura dei dati), [`src/services/voting.js`](src/services/voting.js) (registrazione del voto) e [`src/services/tally.js`](src/services/tally.js) (scrutinio).
