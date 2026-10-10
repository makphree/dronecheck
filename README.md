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

## Meteo

Nella scheda **Qui**, per la tua posizione o per il punto toccato sulla mappa, l'app mostra:

- un giudizio: *Meteo adatto al volo*, *Volo con cautela* o *Volo sconsigliato*, con i motivi;
- vento, raffiche, vento a 120 m, temperatura, pioggia, visibilità, pressione con tendenza sulle ultime 3 ore (in rialzo, stabile o in calo), indice Kp, alba e tramonto;
- le prossime 12 ore.

La banda in alto segue la tua posizione GPS oppure il punto toccato sulla mappa (il mirino riporta al GPS). Fuori dalle zone è verde, *Volo libero fino a 120 m*. Se c'è un avviso meteo, la banda si divide: 2/3 per lo stato di volo, 1/3 per il meteo, colorato verde, giallo, arancio o rosso.

I limiti del drone (vento, raffiche, temperatura) si cambiano nella scheda **Filtri**. Fonti: Open-Meteo (previsioni) e NOAA (indice Kp). Senza rete l'app usa l'ultima previsione scaricata per quel punto, fino a 18 ore.

## Uso senza rete

App, zone e ultimo meteo restano sul telefono. Della mappa sono disponibili le parti già viste. Prima di partire inquadra la zona di volo e premi **Dati → Salva l'area visibile**: massimo 250 tessere, come chiedono le regole d'uso di OpenStreetMap.

## Come legge i dati

- **Zone ATM-09:** il limite inferiore è la quota fino alla quale si vola senza autorizzazione. Per esempio `45–120 m AGL` vuol dire libero fino a 45 m.
- **Colori:** sono le stesse fasce di D-Flight (0, 25, 45, 60, 120 m).
- **NOTAM:** sono tratteggiati e contano solo nel loro periodo di validità.
- **Import a mano:** dalla scheda Dati dell'app resta possibile importare un file sul singolo telefono.

## Avvertenze

- QuotaZone è uno strumento personale di consultazione. Non sostituisce la verifica ufficiale su D-Flight, i NOTAM e le autorizzazioni ENAC prima di ogni volo.
- Il repository è pubblico: chiunque conosca l'indirizzo può scaricare il file delle zone. Verifica che i termini d'uso di D-Flight lo consentano.

Mappa © OpenStreetMap · Leaflet 1.9.4 (BSD-2) · Turf 6.5.0 (MIT)
