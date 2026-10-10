# QuotaZone · dronecheck

Mappa personale delle zone geografiche UAS di D-Flight sulla posizione del telefono.
App: **https://makphree.github.io/dronecheck/** (installabile dal browser del telefono).

## Aggiornare le zone (upload manuale)

1. Su [D-Flight](https://www.d-flight.it) → menu → icona dischetto **Download UAS Geo Zone**. Scarica il file `dflight_geozones_AAAAMMGG_hhmmss.json.gz`.
2. In questo repository apri la cartella **`data`** → **Add file → Upload files**.
3. Trascina il file così com'è, **senza rinominarlo**, e premi **Commit changes**.
4. Facoltativo: elimina il file del giorno prima (apri il file → icona cestino → Commit).

Dopo 1–2 minuti il sito si aggiorna. All'apertura, l'app legge l'elenco della cartella `data`, prende il file con la data più recente nel nome e lo scarica solo se è cambiato. Sul telefono le zone restano salvate e funzionano anche senza rete. Se i dati hanno più di 3 giorni, l'app mostra un avviso.

> Ogni upload aggiunge circa 5 MB alla cronologia del repository, anche se poi cancelli il file. GitHub consiglia di restare sotto 1 GB, cioè circa 6 mesi di upload quotidiani. Per andare oltre c'è la versione automatica (branch `proxmox-auto`), che sostituisce il file senza accumulare cronologia.

## Come legge i dati

- **Zone ATM-09:** il limite inferiore è la quota fino alla quale si vola senza autorizzazione. Per esempio `45–120 m AGL` vuol dire libero fino a 45 m.
- **Colori:** sono le stesse fasce di D-Flight (0, 25, 45, 60, 120 m).
- **NOTAM:** sono tratteggiati e contano solo nel loro periodo di validità.
- **Import a mano:** dalla scheda Dati dell'app resta possibile importare un file sul singolo telefono.

## Avvertenze

- QuotaZone è uno strumento personale di consultazione. Non sostituisce la verifica ufficiale su D-Flight, i NOTAM e le autorizzazioni ENAC prima di ogni volo.
- Il repository è pubblico: chiunque conosca l'indirizzo può scaricare il file delle zone. Verifica che i termini d'uso di D-Flight lo consentano.

Mappa © OpenStreetMap · Leaflet 1.9.4 (BSD-2) · Turf 6.5.0 (MIT)
