# Giorno del voto — guida rapida per amministratore e scrutatori

## Il giorno prima
- [ ] Server acceso, `https://voto.magnetico.cloud` risponde e in fondo alla pagina c'è la versione congelata (es. `v1.0.0`).
- [ ] Data dell'assemblea corretta nelle impostazioni (serve per età e tessere).
- [ ] **Anagrafica completa** importata in «3. Eleggibili». Controlla il riepilogo degli esclusi (tessere scadute, minorenni, doppioni) e segnala alla segreteria eventuali errori.
- [ ] Scheda controllata: domande, posti, preferenze, candidati.
- [ ] Prova completa su una **votazione di prova separata** (con te stesso come avente diritto): l'email arriva, il QR funziona, il voto si registra. Poi eliminala.
- [ ] Schede cartacee stampate (piano B) e penne.

## In assemblea, prima dell'apertura
1. Accedi al pannello (password + codice dell'app di autenticazione).
2. Appello per eventuali altre candidature: aggiungile nella scheda **prima** di aprire.
3. Chiuso l'appello (in sala e su Meet), la segreteria esporta l'**anagrafica filtrata sui presenti**: importala in «4. Aventi diritto e codici» e controlla il riepilogo.
   - Arriva qualcuno dopo? Ricarica il file aggiornato: si aggiungono solo i nuovi. In alternativa «Aggiungi a mano un avente diritto».
4. **10–15 minuti prima dell'apertura**: «Invia i codici via email». Per chi non ha email: «Stampa cartellini».
   - Email non arrivata o codice perso? Nella riga del socio: «Nuovo codice» (via email) o «Stampa». Il vecchio codice smette di funzionare.
5. Apri «Schermo da proiettare», mettilo a schermo intero e condividilo su Google Meet. Tasto **H** per nascondere i comandi.

## Votazione
6. Clic su **Inizia votazione**: compaiono QR code, indirizzo e timer.
7. Durante il voto il contatore mostra solo quanti hanno votato, mai per chi.
8. Problema tecnico documentato? **Proroga +2 min**, una sola volta. Annotala nel verbale.
9. Allo zero il voto si chiude da solo e compaiono i risultati. Per sommare prima le schede cartacee: **Nascondi risultati**.

## Scrutinio
10. Leggi i risultati: eletti, schede bianche, astenuti, **riconciliazione corretta ✓** (codici usati = schede).
11. Schede cartacee: «Risultati e verbale» → «Piano B» per ogni domanda. Restano su righe separate.
12. **Parità all'ultimo posto utile**: «Prepara ballottaggio» → «Inizia votazione». Stessi codici, nuovo QR code, una sola preferenza.
    Parità anche al ballottaggio: si procede secondo la delibera del Consiglio Direttivo (es. sorteggio).
13. «Risultati e verbale» → **Stampa / Salva PDF** e **Scarica CSV** per il verbale.

## Dopo l'assemblea
- [ ] Backup: `./scripts/backup.sh` sul server.
- [ ] «Cancella i dati personali» (nomi ed email). Restano risultati e registro.
- [ ] Server spento da AWS se non serve più.

## Se qualcosa va storto
| Problema | Cosa fare |
|---|---|
| «Codice non valido» | Controlla di averlo copiato tutto (12 caratteri). Se persiste: nuovo codice dal pannello. |
| «Codice già usato» | Il voto con quel codice è già registrato. Non si può votare di nuovo. |
| Telefono senza rete a metà invio | Riprovare «Conferma e invia»: se il voto era arrivato, compare «Voto registrato». |
| Schermo bloccato o Meet caduto | Il voto prosegue e si chiude comunque in orario. Riapri lo schermo dal pannello. |
| Server irraggiungibile | **Piano B**: schede cartacee, poi i totali nel pannello o nel verbale. |
