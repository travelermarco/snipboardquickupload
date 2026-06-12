# Snipboard Quick Upload — Changelog

## v1.2.0 — 2026-06-12 (fix definitivo)

### Bug: immagine sempre 403 — upload mai completato

**Causa radice:** `chrome.webNavigation.onHistoryStateUpdated` nel background
chiamava `settle()` (che chiude il tab) **immediatamente** quando rilevava l'URL
dalla `history.pushState`. Snipboard usa navigazione ottimistica: chiama
`pushState('/ID.jpg')` **prima** che l'upload HTTP sia completato. Chiudere il tab
in quel momento cancellava l'upload in corso — quindi l'immagine non arrivava mai
sul CDN `i.snipboard.io`.

**Fix:**
1. `navHandler` e `msgHandler` **non chiamano più `settle()`** quando vedono l'URL.
   Salvano solo `pendingUrl` e avviano `startCdnPoll()`.
2. `startCdnPoll()` gira nel background service worker (non nel tab), fa richieste
   `HEAD https://i.snipboard.io/ID.jpg?nocache=...` ogni 500 ms finché riceve HTTP 200.
   Il tab rimane aperto durante tutto questo tempo — l'upload può terminare.
3. Solo quando il CDN risponde 200 (o dopo 30 s di timeout) il tab viene chiuso e
   l'URL viene restituito al content script.
4. Rimosso il wrapper `fetch`/`XHR` dal `mainWorldScript` per eliminare qualsiasi
   possibile interferenza con la richiesta di upload di Snipboard.

**In pratica:** il tab ora rimane aperto 2–8 secondi (il tempo che serve a Snipboard
per caricare l'immagine sul CDN), poi si chiude automaticamente. L'URL copiato è
garantito accessibile.

---

## v1.1.1 — 2026-06-12 (hotfix)

### Bug: link copiato non funzionava (immagine vuota)

**Causa:** Snipboard.io usa navigazione ottimistica — chiama `history.pushState('/NGe7uq.jpg')` 
**prima** di completare l'upload HTTP. L'estensione vedeva l'URL dal pushState, chiudeva il tab,
e cancellava l'upload in corso. Risultato: URL esistente ma immagine mai caricata.

**Fix in `mainWorldScript`:**
- Introdotte due funzioni distinte:
  - `reportNow(url)` — usata quando fetch/XHR risponde (upload CONFERMATO dal server) → chiude subito
  - `reportAfterDelay(url)` — usata per pushState/DOM → aspetta 4s così l'upload finisce prima che il tab venga chiuso
- pushState, replaceState e DOM poll usano tutti `reportAfterDelay`
- fetch/XHR interception usa `reportNow`

**Fix regex:** aggiunta estensione file opzionale (`(?:\.[a-zA-Z]{2,4})?`) per catturare
`snipboard.io/NGe7uq.jpg` invece di troncare a `snipboard.io/NGe7uq`.

---

## v1.1.0 — 2026-06-12

### Bug fix + ottimizzazione velocità

#### Problema risolto
La v1.0.0 rileva l'URL del tab tramite `chrome.tabs.get().url` ogni 400ms.
Snipboard.io usa `history.pushState` per aggiornare l'URL lato client, e il link
risultante era spesso nel **DOM della pagina** (input, ancora) — non nell'URL del tab.
Risultato: timeout di 30s anche se l'upload era già avvenuto correttamente.

#### Cambiamenti in background.js
| Prima (v1.0.0) | Dopo (v1.1.0) |
|---|---|
| Polling `chrome.tabs.get()` ogni 400ms | Intercezione di rete immediata (fetch/XHR) |
| Attesa iniziale 1800ms | Attesa iniziale 400ms |
| Nessun caching del endpoint | Endpoint caching (sessione + memoria) |
| Timeout 30s | Timeout 25s con rilevamento molto più rapido |

#### Come funziona ora il tab approach
1. Apre il tab nascosto (active: false)
2. Attende caricamento + 400ms per hydration JS
3. Inietta **ISOLATED world** listener (pronto a ricevere risultati)
4. Inietta **MAIN world** script che:
   - Sovrascrive `window.fetch` → cattura l'URL dal body della risposta server
   - Sovrascrive `XMLHttpRequest.send` → stessa cosa per XHR
   - Sovrascrive `history.pushState/replaceState` → rileva navigazione client-side
   - Scrive il risultato in un `<div>` nascosto nel DOM
   - Fa anche polling di URL + input + anchor come fallback
5. ISOLATED world polling il `<div>` ogni 150ms → `chrome.runtime.sendMessage`
6. Background riceve il messaggio → chiude il tab → ritorna l'URL
7. **Endpoint caching**: se l'URL dell'endpoint upload è identificato, viene salvato
   in `chrome.storage.session` + variabile in-memory. Le upload successive saltano
   il tab e fanno POST diretto → quasi istantaneo.

#### Nuovi permessi (manifest v1.1.0)
- `webNavigation` — `onHistoryStateUpdated` + `onCommitted` per navigazione extra
- `storage` — `chrome.storage.session` per caching endpoint cross-restart SW

---

## v1.0.0 — 2026-06-12

### Nuova estensione Chrome (Manifest V3)

#### File creati

| File | Scopo |
|---|---|
| `manifest.json` | Configurazione estensione MV3 |
| `content.js` | UI persistente su tutte le pagine |
| `background.js` | Logica di upload verso Snipboard.io |
| `icons/icon16.png` | Icona 16×16 per la toolbar |
| `icons/icon48.png` | Icona 48×48 per la toolbar |
| `icons/icon128.png` | Icona 128×128 per il Chrome Web Store |
| `create_icons.py` | Script Python che ha generato le icone |

---

### Cosa fa l'estensione

1. **Pulsante persistente** — In basso a sinistra su ogni pagina (eccetto snipboard.io stessa)
   appare un pulsante circolare blu con icona camera (48×50 px, z-index massimo).
   Non interferisce con il layout della pagina.

2. **Click → controlla clipboard** — Usando `navigator.clipboard.read()` l'estensione
   legge la clipboard di sistema. Se non contiene un'immagine, mostra un avviso.

3. **Upload automatico** — L'immagine viene inviata al service worker di background che
   tenta due strategie in sequenza:

   **Strategia 1 — POST diretto** (preferita, invisibile all'utente)
   Tenta `POST multipart/form-data` agli endpoint più probabili di Snipboard.io
   (`/upload.php`, `/upload`) con i campi `image` e `file`. Analizza la risposta
   (redirect URL, JSON, HTML) per estrarre il link generato.

   **Strategia 2 — Tab nascosta** (fallback)
   Apre `snipboard.io` in un tab di background (`active: false`, non visibile all'utente),
   inietta uno script che simula un evento `paste` con l'immagine reale (DataTransfer +
   ClipboardEvent), poi fa polling del tab URL ogni 400 ms finché Snipboard lo aggiorna
   al link dell'immagine caricata. Il tab viene chiuso subito dopo.

4. **Link in clipboard** — Il link Snipboard (es. `https://snipboard.io/Gd7Wu3`) viene
   scritto automaticamente nella clipboard tramite `navigator.clipboard.writeText()`.

5. **Toast notification** — Appare per ~6 secondi sopra il pulsante:
   - `Caricamento su Snipboard.io…` (durante l'upload)
   - `✓ Link copiato: https://snipboard.io/XXXXXX` (successo)
   - Messaggio di errore in rosso (fallimento)

---

### Permessi richiesti

| Permesso | Motivo |
|---|---|
| `clipboardRead` | Leggere immagini dalla clipboard |
| `clipboardWrite` | Scrivere il link risultante nella clipboard |
| `scripting` | Iniettare script nel tab nascosto (fallback) |
| `tabs` | Aprire/chiudere il tab nascosto (fallback) |
| `host_permissions: snipboard.io/*` | Fetch cross-origin verso Snipboard.io |
| `host_permissions: <all_urls>` | Accesso clipboard nelle content script su ogni sito |

---

### Compatibilità

- Chrome 116+ (MV3 + Clipboard API + `chrome.scripting`)
- macOS e Windows (clipboard system-wide)
- Funziona su pagine HTTP e HTTPS

---

### Come installare (modalità sviluppatore)

1. Apri `chrome://extensions/`
2. Attiva **Modalità sviluppatore** (in alto a destra)
3. Clicca **Carica estensione non pacchettizzata**
4. Seleziona la cartella `Snipboard Extection`
5. Il pulsante camera blu appare su tutte le pagine

### Flusso d'uso

```
Cmd+Shift+4 (Mac) / PrtScn (Win)   → screenshot in clipboard
click pulsante camera                → upload automatico
~2–5 secondi                        → link copiato
Cmd+V / Ctrl+V                      → incolla il link ovunque
```
