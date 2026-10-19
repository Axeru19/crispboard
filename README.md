# Crispboard

Gestore di clipboard per Windows 11, ispirato a [Ditto](https://github.com/sabrogden/Ditto). Replica le funzioni core di Ditto e aggiunge modifica in-place, etichette colorate e pin.

- Analisi di Ditto: [`docs/ditto-analysis.md`](docs/ditto-analysis.md) (include la matrice di parità)
- Architettura e design system: [`docs/design-system.md`](docs/design-system.md)

## Requisiti

- Windows 10/11 x64
- Node.js 24 o superiore (per sviluppo; l'eseguibile pacchettizzato non lo richiede)

## Avvio da sorgente

```powershell
npm install
npm start
```

L'app resta nell'area di notifica. Scorciatoia predefinita: **Ctrl+Alt+V** (cambiabile in Impostazioni).
Un secondo avvio apre il popup dell'istanza già in esecuzione.

## Pacchetto eseguibile

```powershell
npm run dist          # crea dist\win-unpacked\Crispboard.exe
```

## Test

```powershell
npm test              # test unitari (database, ricerca, retention, export/import, trasformazioni, cifratura)
npm run e2e           # end-to-end sull'app reale (vedi sotto)
npm run icons         # rigenera src/renderer/icons.js da Phosphor
node scripts/make-icon.mjs   # rigenera le icone in assets/
```

`npm run e2e` avvia l'app, usa la clipboard di Windows, pilota il popup via Chrome DevTools Protocol e incolla in una finestra WinForms di prova. Deve avere il focus della tastiera: non usare il PC durante l'esecuzione (circa 2 minuti). Screenshot e log finiscono nella cartella indicata come argomento.

## Uso

| Azione | Tasto |
|---|---|
| Aprire / chiudere | Ctrl+Alt+V |
| Navigare | ↑ ↓ PagSu PagGiù |
| Incollare | Invio, doppio clic, Ctrl+1…9,0 (posizione) |
| Incollare come testo semplice | Maiusc+Invio |
| Incolla speciale (maiuscolo, slug, camelCase…) | clic destro → Incolla speciale |
| Cercare | digita; modalità Testo / Jolly / Regex |
| Modificare la clip sul posto | Ctrl+E o F2; salva con Ctrl+Invio, annulla con Esc |
| Fissare in cima (pin) | Ctrl+P |
| Etichette | Ctrl+L (digita per filtrare o creare), filtro Alt+1…8 |
| Spostare | Alt+↑ / Alt+↓ |
| Elimina | Ctrl+D o Canc |
| Nuova clip | Ctrl+N |
| Selezione multipla | Maiusc+↑/↓, Ctrl+clic; Invio incolla tutto con il separatore |
| Anteprima | F3 |

### Le tre funzioni nuove
1. **Modifica in-place**: Ctrl+E trasforma il pannello di anteprima in un editor; le clip modificate sono marcate e il testo di ricerca si aggiorna. I formati HTML/RTF della clip, ormai obsoleti, vengono scartati al salvataggio.
2. **Etichette colorate**: una clip può averne più di una; chip cliccabili sopra la lista filtrano all'istante (Alt+1…8); gestione completa in Impostazioni → Etichette.
3. **Pin**: le clip fissate stanno in una sezione in cima e non vengono mai eliminate da limite di clip, scadenza o "elimina non usate".

## Dati

- Database: `%APPDATA%\Crispboard\crispboard.db` (SQLite, WAL). Variabile `CRISPBOARD_DATA_DIR` per cambiare cartella.
- Esporta/importa JSON, backup e ripristino dalle Impostazioni → Dati.

## Sicurezza e privacy

- Rispetta il formato `ExcludeClipboardContentFromMonitorProcessing` (gestori di password): quei contenuti non vengono salvati. Elenco di applicazioni escluse configurabile (predefiniti: KeePass, 1Password, Bitwarden, LastPass, Dashlane).
- Il renderer non ha accesso a Node (`contextIsolation`, `sandbox`); i canali IPC sono in whitelist.
- La cronologia è salvata in chiaro nel database locale, come in Ditto.
- La sincronizzazione LAN è disattivata di default; quando attiva apre una porta TCP (predefinita 23443) e accetta solo messaggi cifrati con la password condivisa.

## Decisioni di progetto annotate

- **Electron** perché sul PC non ci sono toolchain native (.NET SDK, Rust, MSVC). Memoria: circa 300 MB di working set sul processo (ridotti da GPU disattivata); è il costo principale rispetto a Ditto (decine di MB).
- **Clipboard via Win32 (koffi)**: l'API clipboard di Electron 44 è asincrona e non espone CF_HDROP, RTF, HTML Format.
- **Gruppi → etichette**: molti-a-molti, senza sottogruppi annidati.
- Hotkey predefinita Ctrl+Alt+V invece di Ctrl+\` (assente sulla tastiera italiana).

## Limitazioni note

- Non replicati: diff tra clip, QR code, Google Translate, invio email, ChaiScript e addin DLL, import di temi XML di Ditto, localizzazione oltre l'italiano.
- Solo le scorciatoie globali sono riassegnabili; le scorciatoie interne al popup sono fisse.
- L'incolla in applicazioni eseguite come amministratore non funziona se Crispboard non lo è a sua volta.
- Le clip di testo oltre 300 000 caratteri non si modificano in-place (anteprima troncata).
- Immagini: sono decodificate le DIB a 24/32 bit; formati a palette (1/4/8 bit) non vengono catturati se non esiste anche il formato PNG.
- L'eseguibile non è firmato: SmartScreen può segnalarlo.
- Il test e2e dipende dal focus della tastiera e va eseguito a PC inattivo.
- Il pacchetto `dist\win-unpacked` pesa circa 380 MB (runtime Electron).
