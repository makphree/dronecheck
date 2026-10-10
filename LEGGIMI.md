# QuotaZone

Mappa personale delle zone geografiche UAS sulla posizione del telefono. È una web app installabile (PWA): funziona sul POCO (Chrome) e sull'iPhone (Safari) con lo stesso codice.

## Cosa fa

- Barra in alto colorata secondo la zona in cui ti trovi (vietato, serve autorizzazione, condizionato, libero) con la **quota massima** più bassa tra le zone sovrapposte.
- Distanza dalle zone più vicine (entro 10 km) e avviso "al confine" quando l'incertezza del GPS tocca un bordo. Su Android vibra quando entri in una zona più restrittiva.
- Tocca la mappa per ispezionare un punto qualsiasi; tieni premuto per salvarlo come punto personale (es. punti di decollo). I punti si esportano/importano in JSON.
- Filtri per tipo di restrizione e motivo. Gli avvisi considerano sempre tutte le zone, anche quelle nascoste.
- Offline: l'app, le zone importate e le tessere di mappa già viste restano sul telefono.

## Pubblicarla (serve HTTPS)

Il GPS nel browser funziona solo su HTTPS. Il modo più semplice e gratuito:

**GitHub Pages**
1. Crea un repository (anche privato con account Pro, altrimenti pubblico) e carica il contenuto di questa cartella.
2. Settings → Pages → Branch `main`, cartella `/ (root)` → Save.
3. Dopo un minuto l'app è su `https://<utente>.github.io/<repo>/`.

In alternativa: Cloudflare Pages o Netlify (trascina la cartella nel pannello).

## Installarla sul telefono

- **POCO / Android (Chrome):** apri l'indirizzo → menu ⋮ → *Installa app*. Consenti la posizione "precisa".
- **iPhone (Safari):** apri l'indirizzo → Condividi → *Aggiungi alla schermata Home*. Impostazioni → Privacy → Localizzazione → Safari: "Mentre usi l'app" + "Posizione esatta".

Limite delle web app: il GPS è attivo solo con l'app aperta in primo piano (niente tracciamento in background). Se servirà, il passo successivo è un'app Android nativa.

## I dati D-Flight

1. Accedi alla Web App di [D-Flight](https://www.d-flight.it), apri il menu (logo in alto a sinistra) e premi l'icona del dischetto **"Download UAS Geo Zone"**.
2. Scarica il file `dflight_geozones_AAAAMMGG_hhmmss.json.gz` (circa 5 MB, formato ED-269 compresso). Non serve decomprimerlo.
3. Portalo sul telefono (Drive, AirDrop, email, cavo) e in QuotaZone → **Dati** → *Importa file zone…*.

Il file del 10/10/2026 contiene 4.532 zone (4.893 poligoni): 3.749 aerodromi e avio (ATM-09), 406 no-fly zone, 377 NOTAM temporanei. Il caricamento richiede circa 2 secondi.

Come legge i dati QuotaZone: nelle zone ATM-09 il limite inferiore è la quota fino alla quale si vola senza autorizzazione (es. `45–120 m AGL` = libero fino a 45 m). La mappa usa le stesse fasce di colore di D-Flight (0, 25, 45, 60, 120 m). I NOTAM sono tratteggiati e contano solo nel loro periodo di validità.

D-Flight non ha API: per aggiornare i dati riscarica il file. Dopo 7 giorni l'app mostra un avviso. Il file resta solo sul telefono.

## Avvertenza

QuotaZone è uno strumento personale di consultazione. Non sostituisce la verifica ufficiale su D-Flight, i NOTAM e le autorizzazioni ENAC prima di ogni volo.

## File

| File | Contenuto |
|---|---|
| `index.html`, `app.css`, `app.js` | l'app |
| `sw.js` | service worker (offline, cache tessere) |
| `manifest.webmanifest`, `icons/` | installazione come app |
| `vendor/` | Leaflet 1.9.4 e Turf 6.5.0 (licenze incluse) |

Mappa © OpenStreetMap. Le tessere vengono salvate solo quando le visualizzi: le regole d'uso di OpenStreetMap vietano lo scaricamento massivo di aree intere.
