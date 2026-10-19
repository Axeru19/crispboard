# Crispboard: architettura e design system

Registro: **product** (strumento a servizio del flusso di lavoro, non vetrina).
Scena fisica: una persona nel mezzo di un documento, a qualsiasi ora, preme un tasto e deve ritrovare e incollare un frammento in meno di due secondi, senza staccare le mani dalla tastiera. Luce ambiente variabile, quindi tema che segue Windows (chiaro/scuro) e non un default scelto a gusto.

---

## 1. Stack e architettura

| Scelta | Motivazione |
|---|---|
| **Electron 44** (Node 24) | Nessun toolchain nativo sul PC (no .NET SDK, Rust, MSVC): Electron è l'unica via a una UI ricca già eseguibile. Mitigazione del peso: una sola finestra creata una volta e nascosta (riapertura < 50 ms), nessun framework UI, renderer in JS/CSS nativi senza bundler. |
| **`node:sqlite`** (built-in in Node 24) | Zero dipendenze native da compilare, WAL, ricerca con `LIKE`/regex su colonna normalizzata. |
| **Clipboard via koffi, non API Electron** | Electron 44 ha reso la clipboard asincrona e senza formati arbitrari (niente CF_HDROP, RTF, HTML Format). Letture/scritture Win32 dirette con `OpenClipboard`/`EnumClipboardFormats`. |
| **koffi** (FFI prebuilt) | Chiamate Win32 senza compilatore: `GetClipboardSequenceNumber`, `SendInput`, `GetForegroundWindow`, `GetGUIThreadInfo` (caret), `QueryFullProcessImageNameW` (app sorgente), `SetForegroundWindow`. |
| **Geist + Geist Mono** (`@fontsource-variable`) | Font self-hosted, nessuna richiesta di rete. |
| **Phosphor Icons** (`@phosphor-icons/core`, SVG inline) | Una sola famiglia, stroke uniforme. |
| Nessun React/bundler | Avvio rapido, memoria bassa, nessuna build step: `npm start`. |

### Processi
```
main (Node)                               renderer (una finestra, nascosta quando non serve)
├─ db.js          schema, query, retention  ├─ index.html / styles.css (token)
├─ watcher.js     poll sequence number 120ms├─ app.js     stato + render lista (virtualizzata)
├─ win32.js       FFI koffi                 ├─ editor.js  modifica in-place
├─ paste.js       restore focus + Ctrl+V    ├─ labels.js  etichette/filtri
├─ hotkeys.js     globalShortcut            └─ keys.js    mappa tasti
├─ windows.js     popup + settings
├─ tray.js, settings.js, transforms.js, exporter.js
└─ ipc (preload.js, contextBridge, nessun nodeIntegration)
```
**Cattura**: il watcher confronta `GetClipboardSequenceNumber` ogni 120 ms (costo trascurabile). Al cambio legge i formati con `clipboard.availableFormats()` + `readBuffer`, calcola l'hash SHA-1 dei formati principali, applica filtri (app escluse, dimensione max, finestra anti-duplicato, connessione attiva), salva `clips` + `formats`, applica retention, notifica il renderer.
**Incolla**: la finestra non prende il focus dell'app (non-activating dove possibile); alla scelta si nasconde, si ripristina la finestra in primo piano salvata all'apertura, si scrive la clip nella clipboard (con il watcher in "ignora il prossimo cambio") e si invia Ctrl+V (o Shift+Insert per terminali) con `SendInput`.
**Dati**: `%APPDATA%\Crispboard\crispboard.db`; impostazioni nella tabella `settings` (JSON).

### Schema
```sql
clips(id PK, created_at, last_used_at, use_count, kind, preview, search_text, hash UNIQUE-ish,
      size, pinned INT, pin_order REAL, sort_order REAL, quick_name, hotkey, source_app, source_title,
      source_url, edited INT)
formats(id PK, clip_id -> clips ON DELETE CASCADE, format, data BLOB)
labels(id PK, name UNIQUE, color, position)
clip_labels(clip_id, label_id, PRIMARY KEY(clip_id,label_id))   -- assegnazione multipla
settings(key PK, value)
```
Retention: `DELETE FROM clips WHERE pinned=0 AND never_delete=0 AND (…oltre max OR scaduta)`. **I pin non vengono mai toccati.**

### Deviazioni consapevoli da Ditto (annotate)
1. **Gruppi → etichette** (molti-a-molti, colorate). Niente sottogruppi annidati: l'assegnazione multipla e il filtro rapido li rendono superflui.
2. **Sticky → pin** con ordine proprio, in cima, esente da pulizia (richiesto).
3. **Friends (sync LAN)**: reimplementato come push TCP cifrato AES-256-GCM con password condivisa.
4. **ChaiScript/addin DLL**: non replicati.

---

## 2. Design system

### Principi
1. **La tastiera è l'interfaccia principale**: ogni azione ha un tasto visibile nel punto in cui serve.
2. **Una sola cosa evidente**: la riga selezionata. Il resto arretra.
3. **Densità calma**: righe a 2 righe di testo, niente cornici attorno a tutto.
4. **Il colore significa qualcosa**: l'accento indica selezione/focus; il colore dei punti è identità dell'etichetta; mai decorativo.

### Colore (OKLCH, neutri tinti verso hue 200, strategia *Restrained*)
| Token | Scuro | Chiaro |
|---|---|---|
| `--bg` | `oklch(0.175 0.008 200)` | `oklch(0.985 0.004 200)` |
| `--surface` | `oklch(0.215 0.009 200)` | `oklch(0.962 0.005 200)` |
| `--surface-2` | `oklch(0.26 0.010 200)` | `oklch(0.93 0.006 200)` |
| `--border` | `oklch(0.32 0.010 200)` | `oklch(0.88 0.007 200)` |
| `--text` | `oklch(0.94 0.006 200)` | `oklch(0.22 0.010 200)` |
| `--text-2` | `oklch(0.74 0.010 200)` | `oklch(0.42 0.012 200)` |
| `--text-3` | `oklch(0.58 0.010 200)` | `oklch(0.52 0.012 200)` |
| `--accent` | `oklch(0.80 0.15 160)` | `oklch(0.50 0.13 160)` |
| `--accent-ink` (testo su accento) | `oklch(0.20 0.04 160)` | `oklch(0.99 0.005 160)` |
| `--accent-soft` (sfondo selezione) | `oklch(0.80 0.15 160 / 0.14)` | `oklch(0.50 0.13 160 / 0.10)` |
| `--danger` | `oklch(0.72 0.17 25)` | `oklch(0.55 0.18 25)` |

Etichette (8): corallo 25, arancio 55, giallo 95, verde 145, azzurro 235, indaco 270, rosa 350, ardesia (c 0.03). Scuro `L .74 C .14`, chiaro `L .58 C .15`. Contrasto testo/bg ≥ 4.5:1 verificato nei due temi; l'accento su `--bg` ≥ 3:1 (usato solo per anelli/indicatori e testo grande).

### Tipografia
Geist Variable (UI) e Geist Mono (anteprime codice, scorciatoie, numeri). Scala con rapporto ≥ 1.25: 11 / 12.5 / 14 / 17 / 22 px. Corpo righe 13.5 px / 1.4; meta 11.5 px. Tabular figures per orari e contatori. Larghezza testo anteprima ≤ 75ch.

### Spaziatura e forma
Base 4 px; scala 4, 8, 12, 16, 24. Padding riga 10×12 (ritmo variabile: header sezione 16/8). **Raggi (regola unica)**: finestra = angoli nativi di Windows 11, controlli/righe 8, chip e badge pillola (999). Ombra finestra tinta sul fondo: `0 20px 60px oklch(0.1 0.02 200 / 0.45)`; nessuna ombra altrove, solo bordi 1 px.

### Layout (finestra 780×520, frameless, ridimensionabile)
```
┌───────────────────────────────────────────────────────────────┐
│ 🔍 Cerca…                 [Testo] [Regex]              ⚙      │  barra ricerca 48px
│ ● Lavoro  ● Codice  ● Link  ● Personale   + etichetta         │  filtro etichette (chip)
├───────────────────────────────┬───────────────────────────────┤
│ FISSATI                       │  anteprima / editor           │
│ 1 ▸ riga pinnata              │  (testo, immagine, file, html)│
│ RECENTI                       │                               │
│ 2   riga                      │  meta: app · ora · dimensione │
│ …                             │  etichette [+]                │
├───────────────────────────────┴───────────────────────────────┤
│ ↵ Incolla  ⇧↵ Testo semplice  Ctrl+E Modifica  Ctrl+P Fissa  Ctrl+L │  barra comandi 36px
└───────────────────────────────────────────────────────────────┘
```
Sotto 640 px l'anteprima collassa (la lista occupa tutto; Tab alterna).

### Componenti e stati
- **Riga clip**: icona tipo (16) · testo su 2 righe (clamp) · meta (app, ora relativa) · punti etichetta · indice 1–9,0 (Ctrl+N). Stati: *hover* `--surface`; *selezione* `--accent-soft` + indicatore sinistro pieno 2 px **non** usato (vietato lo stripe): la selezione si legge dallo sfondo e dall'icona accentata; *focus* anello `--accent` 2 px sulla ricerca; *pinnata* icona puntina accentata e sezione dedicata; *già incollata* indicatore discreto.
- **Chip etichetta**: pillola con punto colore + nome; attiva = sfondo del colore al 18% e bordo del colore; ricerca per etichetta con tasto 1–8 (Alt+N) o clic.
- **Campo ricerca**: senza placeholder-label; scope e modalità come segmented control compatto.
- **Editor in-place**: il riquadro anteprima diventa `textarea` Geist Mono; barra "Salva (Ctrl+↵) · Annulla (Esc)"; indicatore "modificato".
- **Menu contestuale** custom (stesso stile), **toast** in basso per esiti brevi, **stati vuoti** composti ("Nessun risultato per …", "Copia qualcosa per iniziare").
- **Impostazioni**: finestra separata con navigazione laterale (Generale, Scorciatoie, Cronologia, App escluse, Aspetto, Dati).

### Movimento
`transform`/`opacity` soltanto. Apertura popup 140 ms ease-out-quart (fade + 6 px), selezione 90 ms, nessun rimbalzo. `prefers-reduced-motion`: tutto istantaneo.

### Tastiera (tutte rimappabili solo per l'hotkey globale; le altre fisse)
↑/↓ PgUp/PgDn navigano · ↵ incolla · ⇧↵ testo semplice · Ctrl+1…9,0 incolla posizione · Tab sposta il focus sull'anteprima · F3 mostra/nasconde anteprima · Ctrl+E o F2 modifica · Ctrl+P fissa/sblocca · Ctrl+L etichette (digita per filtrare o creare) · Alt+1…8 filtro etichetta · Alt+↑/↓ sposta · Ctrl+D (o Canc a ricerca vuota) elimina · Ctrl+N nuova clip · Esc annulla/svuota/chiude · Ctrl+, impostazioni. (Le lettere singole sono libere: il focus resta sul campo di ricerca.)

### Accessibilità
Ruoli `listbox`/`option`, `aria-activedescendant`, contrasto ≥ 4.5:1, focus sempre visibile, nessuna informazione solo-colore (le etichette hanno anche il nome).
