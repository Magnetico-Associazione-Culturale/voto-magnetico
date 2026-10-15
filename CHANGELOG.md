# Changelog

Tutte le modifiche rilevanti sono elencate qui. Formato: [Keep a Changelog](https://keepachangelog.com/it/1.1.0/). Versioni: [semver](https://semver.org/lang/it/).

## [1.0.0] — 2026-10-15

Prima versione, preparata per l'Assemblea ordinaria del 31 ottobre 2026.

### Votazione
- Votazioni riutilizzabili, con una o più domande per scheda (posti, preferenze massime, voto di altri associati eleggibili).
- Anagrafica soci dall'export del gestionale (Excel `.xlsx` o CSV), in due passi: anagrafica completa per gli eleggibili, anagrafica dei presenti per gli aventi diritto (ricaricabile per i ritardatari).
- Criteri alla data dell'assemblea: socio attivo, maggiorenne, tessera valida; scarto dei doppioni, omonimi distinti dall'anno di nascita, riepilogo degli esclusi.
- Codici monouso di 12 caratteri, inviati via email o stampati su cartellino; nuovo codice per un socio con revoca del precedente.
- Pagina di voto per telefono: codice, scheda con candidati in ordine casuale, ricerca degli eleggibili, «Lascio in bianco», «Mi astengo», riepilogo e conferma, «Vota con un altro codice» per chi ha più codici (più soci con la stessa email).
- Schermo da proiettare: attesa, poi QR code, indirizzo casuale e timer all'apertura, contatore dei voti, risultati alla chiusura (nascondibili).
- Durata configurabile (5 minuti di default), proroga unica di 2 minuti, chiusura automatica decisa dal server.
- Ballottaggio in caso di parità all'ultimo posto utile, con gli stessi codici e una sola preferenza; più ballottaggi in sequenza se le parità riguardano più domande.

### Grafica
- Identità visiva di Magnetico Associazione Culturale: loghi ufficiali, carattere Montserrat servito dal server, schermo da proiettare leggibile in sala e su Meet.

### Scrutinio e verbale
- Risultati per domanda: voti, eletti, parità, schede bianche, astenuti, riconciliazione codici usati = schede.
- Inserimento separato dei totali delle schede cartacee (piano B).
- Esportazione CSV e pagina stampabile / PDF per il verbale.
- Registro delle operazioni amministrative.

### Anonimato e sicurezza
- Codici salvati solo come HMAC-SHA256; schede in tabella separata, senza riferimenti, senza orario, con chiave casuale.
- Legame socio–codice cancellato alla chiusura del voto; cancellazione dei dati personali dopo l'assemblea.
- Nessun log di IP o user agent; nessuna risorsa esterna; Content-Security-Policy restrittiva.
- Amministratori con password scrypt e verifica a due fattori (obbligatoria in produzione).
- Limiti ai tentativi, protezione CSRF, IP letto solo dal proxy fidato.

### Installazione
- Docker Compose per la prova locale (con Mailpit) e per la produzione (con Caddy e HTTPS automatico).
- Script per installazione del server, deploy di una versione precisa, backup e gestione degli amministratori.
