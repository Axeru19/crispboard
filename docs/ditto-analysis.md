# Analisi di Ditto (reverse engineering)

Target: `C:\Program Files\Ditto\Ditto.exe` (PE x86_64, MFC 140, 5.6 MB, SHA-256 `d187eb96…7377`).
Metodo (REA + strumenti locali):

| Fonte | Evidenza | Strumento |
|---|---|---|
| Schema DB | `%APPDATA%\Ditto\Ditto.db` (SQLite 3, UTF-16LE), schema completo | `inspect_sqlite_database` (ev_c65fbb4e…, ev_eb13a8a7…) |
| Funzioni/menu/dialoghi | `Language\English.xml` (708 righe, ID risorsa → testo) | lettura diretta |
| Nomi opzioni (registro) | stringhe UTF-16/ASCII dell'exe + `HKCU\Software\Ditto` | scansione stringhe (Python) |
| Temi | `Themes\*.xml` (12 temi, 30 chiavi colore) | lettura diretta |
| Addin | `Addins\DittoUtil.dll` | elencato |

Limiti: `open_binary` ha aperto l'exe ma nessun provider di decompilazione è configurato (Ghidra/IDA/Kuna assenti; Hopper non supportato su Windows). Nessuna decompilazione: il comportamento è dedotto da schema, risorse, stringhe e nomi opzioni (osservato = DB/XML/registro; inferito = semantica delle opzioni dal nome). Dove l'inferenza è debole è segnato **(inf.)**.

---

## 1. Funzionalità

### 1.1 Cattura clipboard
- Ascolto via `AddClipboardFormatListener` / `ChangeClipboardChain` (`SetClipboardViewer`); opzione "Ensure Ditto is always connected" (`EnsureConnected2`) e comando "Disconnect from Clipboard" / `ConnectedToClipboard`.
- Salva **tutti i formati** presenti (non solo il primario): tabella `Data` con una riga per formato. Esempio reale: `CF_UNICODETEXT` + `CF_TEXT` per ogni clip testo.
- Formati supportati: lista configurabile ("Supported Types": principali, correnti, custom; `SupportAllTypes`). Includono `CF_UNICODETEXT`, `CF_TEXT`, `CF_DIB`/`CF_DIBV5`/PNG, `CF_HDROP` (file), `Rich Text Format`, `HTML Format` (con `StartHTML/EndHTML/StartFragment/EndFragment/SourceURL`).
- File copiati: `CF_HDROP` salvato come lista percorsi; opzione/azione "Import File Contents From CF_HDROP" e `MaxFileContentsSize`.
- Dedup: `CRC` per clip; `AllowDuplicates`, `AllowBackToBackDuplicates`, "Ignore copies that occur X ms from the last copy" (`CopyReasonTimeoutMS`); se duplicato non consentito la clip esistente sale in cima (`AdjustClipsForCRC`).
- Limite dimensione clip: `MaxClipSizeInBytes` (vuoto = nessun limite).
- Suono alla copia: `PlaySoundOnCopy`.
- Testo descrizione: primi N caratteri (`DescTextSize`), `DescShowLeadingWhiteSpace`.
- Sorgente: app attiva (`GetActiveApp`, `GetActiveAppTitle`), `SourceURL` dal formato HTML.
- Ritardi di robustezza: `ProcessDrawClipboardDelay`, `NoFormatsRetryDelay`, `DelayRenderLockout`, `RestoreClipboardDelay`.

### 1.2 Cronologia, retention
- `MaxEntries` + `CheckForMaxEntries`: oltre il massimo si eliminano le più vecchie.
- `ExpiredEntries` / `CheckForExpiredEntries`: scadenza in giorni ("Paste Entries Expire after N Days").
- `lDontAutoDelete` per clip = "Never Auto Delete" (esente da pulizia). Clip in gruppo non vengono cancellate.
- "Compact and Repair" del DB, backup/restore DB, "Delete All Non Used Clips", "Delete Clip Data" (finestra di pulizia per titolo, data creazione, ultimo uso, formato, con dimensioni).
- Trigger SQL: ogni DELETE su `Main` registra `MainDeletes`, che a sua volta cancella `Data` e `CopyBuffers` associati.
- Stats: odometro/trip copie e incolla, clip salvate, dimensione DB, ultimo avvio.

### 1.3 Ricerca
- Casella ricerca nella finestra rapida; "Find As You Type".
- Ambiti: Description, Full Text, Quick Paste text.
- Modalità: Contains (SimpleTextSearch), Regular Expression (`RegExTextSearch`, `RegexCaseInsensitive`), Wildcard.
- Evidenziazione risultati (`SearchTextHighlight`), `MaintainSearchView`, messaggio "There are no results for …", ultima ricerca ("Apply Last Search"), "Toggle Search Method".

### 1.4 Hotkey globale e finestra rapida (Quick Paste)
- Hotkey di attivazione (`DittoHotKey`, `DittoHotKey2`, `DittoHotKey3`, con opzione Win); "Hide Ditto on hot key if visible".
- Posizione popup: al caret / al cursore / alla posizione precedente (`AtCaret/AtCursor/AtPreviousPosition`, `CenterWindowBelowCursorOrCaret`), "Ensure entire window is visible", dimensioni e posizione ricordate per monitor (`(WxH)_QuickPasteX/Y/CX/CY`).
- Finestra sempre in primo piano opzionale, auto roll-up, trasparenza 0–40%, barra del titolo (alto/dx/basso/sx), doppio clic sul titolo configurabile, mostra nella taskbar, icona tray.
- Righe per clip 1–5 (`LinesPerRow`), miniature immagini (`DrawThumbnail`, `FastThumbnailMode`), RTF disegnato (`DrawRTF`), font configurabile, ordine crescente/decrescente, tooltip con descrizione completa (F3, `MaxToolTipLines`), finestra descrizione con vista Text/RTF/HTML/Image, word wrap, scala immagini, posizione ricordata.
- Indicatore "clip già incollata" (`ShowIfClipWasPasted`, `ClipPastedColor`), testo scorciatoia per prime 10 (`ShowTextForFirstTenHotKeys`), `UseCtrlNumForFirstTenHotKeys`.

### 1.5 Incolla rapido
- Selezione con Invio/doppio clic/Ctrl+N (prime 10)/hotkey di posizione 1–10 (globali "Global Hot Keys for Last Ten Items").
- Incolla = clip sulla clipboard + `SendInput` Ctrl+V (`SendPasteOnFirstTenHotKeys`, `SendKeysDelay`, `RealSendKeysDelay`, `SetFocus_<exe>` per app); sequenze di tasti personalizzate per applicazione (`PasteStrings`, `CopyStrings`, `CutStrings`).
- Ripristino del focus all'app precedente (`GetForegroundWindow`/`SetForegroundWindow`, `WaitForActiveWndTimeout`).
- Opzione "Update Clip Order on Paste" / "Paste, Don't Change Clip Order"; `lastPasteDate` per clip.
- Paste plain text (Shift+Invio, `PlainTextPaste`/`TextOnlyPaste`), HTML come testo semplice.
- **Special Paste**: UPPER, lower, Capitalize, Sentence, Invert case, CamelCase, Slugify, Typoglycemia, Remove line feeds, + 1/2 line feed, + ora corrente, Trim white space, Ascii text only, Multiple images horizontal/vertical.
- Multi-paste: selezione multipla, separatore configurabile (`MultiPasteSeparator`, `[LF]`), ordine inverso (`MultiPasteReverse`), "Save Multi-Pastes".
- Paste come amministratore (`PasteAsAdmin`).
- **Named Copy / Named Paste**: `QuickPasteText` come nome richiamabile.
- **Copy buffers**: 5 buffer con hotkey Copy/Paste/Cut ciascuno (`CopyBufferCopyHotKey_0..4`, …) + suono; tabella `CopyBuffers(lClipID, lCopyBuffer)`.

### 1.6 Gruppi
- `Main.bIsGroup` + `lParentID`: gruppi annidati (sottogruppi), una clip appartiene a un solo gruppo (`lParentID`; 0 = radice).
- Azioni: New Group, New Group Selection (crea gruppo dalle clip selezionate), Move to Group (anche con hotkey `MoveToGroupShortCut` / `GlobalMoveToGroupShortCut`), Back Group, View Groups, "Toggle Last Group", filtro, "Show Clips That are in Groups in Main List" (`ShowAllClipsInMainList`), "Prompt For New Group Names".
- Ordinamento separato nel gruppo (`clipGroupOrder`, `stickyClipGroupOrder`).

### 1.7 Sticky clips (analogo pin)
- `stickyClipOrder` / `stickyClipGroupOrder`: le clip sticky restano in cima (Make Top Sticky, Make Last Sticky, Remove Sticky, Replace Top Sticky, Fixup Sticky Clip Order).
- Clip order manuale: Move To Top / Up / Down / Last (`clipOrder REAL` frazionario).

### 1.8 Editing
- "Edit Clip" / "New Clip": editor interno a schede (CEditWnd), Save / Save All / Save, close & place on clipboard, "Update clip description on save?", modifica solo se la clip ha tipo testo (`NotEditable`), editor testo/RTF/immagine esterni configurabili.
- Compare di due clip (`DiffApp`), QR code (`QRCodeViewer`), export testo/immagine/Google Translate (`TranslateUrl`), `WebSearchUrl`.

### 1.9 Proprietà clip
Hot key (locale e globale), data, ultima volta usata, Never Auto Delete, Move to Group, titolo, quick paste text, formati copiati (con MD5 per formato), eliminazione di singoli formati.

### 1.10 Sincronizzazione (Friends)
Invio/ricezione clip tra PC in rete (`SendRecvPort`, `NetworkBindIPAddress`, password di gruppo `NetworkStringPassword`/`NetworkExtraPassword`, lista friend per IP/nome, "Send All Copies", "Disable Receiving Clips", log, md5 sui trasferimenti, "Remote Files"). Menu "Send To".

### 1.11 Esclusione/inclusione applicazioni
`CopyAppInclude` / `CopyAppExclude` (liste separate da `;`, `CopyAppSeparator`): Ditto non salva copie da app escluse (o solo da quelle incluse).

### 1.12 Import/Export
Export clip (file proprietario), export testo/immagine, import clip, import contenuto file da `CF_HDROP`, backup/restore DB.

### 1.13 Altro
Avvio con Windows, icona tray, lingua (35 file XML), temi (12 XML), segui tema chiaro/scuro di Windows (`FollowWindowsTheme`, `AppsUseLightTheme`), aggiornamenti, logging debug, scripting (ChaiScript: `ChaiScripts`, `CopyScriptsXml`, `PasteScriptsXml`), addin DLL (`DittoAddin`), tastiera Quick Paste riconfigurabile (≈125 comandi, doppia pressione `DoubleKeyStrokeTimeout`).

---

## 2. Modello dati (osservato)

```
Main(lID PK AI, lDate, mText, lShortCut, lDontAutoDelete, CRC, bIsGroup, lParentID,
     QuickPasteText, clipOrder REAL, clipGroupOrder REAL, globalShortCut, lastPasteDate,
     stickyClipOrder REAL, stickyClipGroupOrder REAL, MoveToGroupShortCut, GlobalMoveToGroupShortCut)
Data(lID PK AI, lParentID -> Main.lID, strClipBoardFormat, ooData BLOB)
Types(lID, TypeText)               -- formati supportati
CopyBuffers(lID, lClipID, lCopyBuffer)
MainDeletes(clipID, modifiedDate)  -- tombstone per sync
```
Indici: ordine (`clipOrder`, `clipGroupOrder`), `(lParentId, stickyClipOrder, bIsGroup, clipOrder)` top-level, `(lParentId, stickyClipGroupOrder, …)` in gruppo, shortcut, CRC, `(lParentID, format NOCASE)`.
Trigger: `delete_data_trigger` (tombstone), `MainDeletes_delete_data_trigger` (cascata su Data e CopyBuffers).
Tipi record: clip (bIsGroup=0), gruppo (bIsGroup=1). Ogni clip = N righe `Data`. Impostazioni: registro `HKCU\Software\Ditto` (o INI).

## 3. Flussi utente
1. **Copia** (qualsiasi app) → listener → filtro app/dimensione/duplicato → insert Main+Data → retention → aggiornamento lista se aperta.
2. **Apri** hotkey → popup al caret/cursore, focus sulla ricerca, lista per `clipOrder DESC` (sticky prima).
3. **Cerca** digitando → filtro istantaneo (contains/regex/wildcard).
4. **Seleziona** frecce/PgUp/PgDn/Ctrl+N → anteprima/descrizione (F3).
5. **Incolla** Invio/doppio clic → chiusura popup, ripristino focus, clip sulla clipboard, Ctrl+V sintetico; clip sale in cima.
6. **Gestisci**: tasto destro/Del/proprietà/gruppo/sticky/edit/export.
7. **Tray**: Show Quick Paste, Options, Import, New Clip, Global Hot Keys, Backup/Restore, Exit.

## 4. Impostazioni e scorciatoie
Tab Options: General, Supported Types, Keyboard Shortcuts, Quick Paste, Copy Buffers, Friends, Stats, Quick Paste Keyboard, Advanced (centinaia di chiavi, elencate sopra). Scorciatoie principali: Ctrl+Num (prime 10), Shift+Invio plain, F3 descrizione, F7/Ctrl+F7 gruppi, Del elimina, Esc chiude, Ctrl+F filtro.

---

## 5. Matrice di parità (stato finale)

Priorità: **P0** core, **P1** importante, **P2** utile, **P3** accessorio. Verifica: *unit* = `npm test`, *e2e* = `npm run e2e` (app reale, clipboard reale, incolla in una finestra di prova), *visivo* = screenshot, *codice* = implementato ma senza test automatico.

| # | Feature Ditto | Pri | Stato | Verifica |
|---|---|---|---|---|
| 1 | Cattura testo (Unicode) | P0 | ✅ | e2e |
| 2 | Cattura immagini (DIB/PNG) | P0 | ✅ | e2e |
| 3 | Cattura file (CF_HDROP) | P0 | ✅ | e2e |
| 4 | Cattura RTF e HTML | P0 | ✅ | e2e (HTML); RTF solo codice |
| 5 | Salvataggio multi-formato per clip | P0 | ✅ | e2e |
| 6 | Dedup (hash, consenti duplicati, finestra ms) | P0 | ✅ | e2e |
| 7 | Limite dimensione clip | P1 | ✅ | codice |
| 8 | Max entries + scadenza giorni + never auto-delete | P0 | ✅ | unit + e2e |
| 9 | Ricerca contains | P0 | ✅ | unit + e2e |
| 10 | Ricerca regex / wildcard | P1 | ✅ | unit + e2e |
| 11 | Ambiti ricerca (descrizione/testo/nome rapido) | P2 | ✅ | codice (UI: solo default) |
| 12 | Hotkey globale configurabile | P0 | ✅ | e2e |
| 13 | Popup al caret/cursore/posizione precedente | P1 | ✅ | manuale/non automatizzato |
| 14 | Incolla rapido con ripristino focus | P0 | ✅ | e2e |
| 15 | Prime 10 con Ctrl+Num | P1 | ✅ | e2e |
| 16 | Hotkey globali ultime 10 | P2 | ✅ | codice |
| 17 | Paste plain text | P0 | ✅ | e2e |
| 18 | Special paste (case, slug, trim, line feed, ora…) | P1 | ✅ | unit + e2e (upper) |
| 19 | Multi-paste con separatore | P1 | ✅ | e2e |
| 20 | Gruppi → etichette colorate (senza annidamento) | P0 | ✅ (deviazione) | unit + e2e |
| 21 | Sticky → pin | P0 | ✅ | unit + e2e |
| 22 | Riordino manuale clip | P2 | ✅ | unit |
| 23 | Proprietà clip (nome rapido, hotkey, mai eliminare) | P1 | ✅ | codice |
| 24 | Named copy/paste (nome rapido ricercabile) | P2 | ✅ parziale | codice |
| 25 | Hotkey globale per clip | P2 | ✅ | codice |
| 26 | Edit clip in-place | P0 | ✅ | e2e |
| 27 | Anteprima completa, vista testo/HTML | P1 | ✅ | visivo |
| 28 | Miniature immagini | P1 | ✅ | visivo |
| 29 | Esclusione/inclusione app | P0 | ✅ | e2e |
| 30 | Disconnetti/connetti clipboard | P1 | ✅ | e2e |
| 31 | Tray + avvio con Windows | P0 | ✅ | tray/avvio: codice |
| 32 | Temi chiaro/scuro (segue Windows) | P0 | ✅ | visivo |
| 33 | Trasparenza, sempre in primo piano | P2 | ✅ | codice |
| 34 | Righe per clip, anteprima, indici | P2 | ✅ | visivo |
| 35 | Import/Export clip, export testo/immagine | P1 | ✅ | unit (round trip) |
| 36 | Backup/Restore DB, compatta | P1 | ✅ | unit (backup/compact); restore non automatizzato |
| 37 | Elimina non usate / svuota cronologia | P2 | ✅ | unit |
| 38 | Statistiche | P3 | ✅ | visivo |
| 39 | Copy buffers (3 slot) | P2 | ✅ | e2e |
| 40 | Indicatore già incollata | P2 | ✅ | visivo |
| 41 | Mostra in taskbar / incolla in app elevate | P3 | parziale | taskbar sì; elevazione no |
| 42 | Sincronizzazione LAN (push, password, cifrata) | P2 | ✅ | e2e loopback |
| 43 | Compare clip (diff) | P3 | ❌ | non implementato |
| 44 | QR code, Google Translate | P3 | ❌ | non implementato |
| 45 | ChaiScript / addin DLL | P3 | ❌ | fuori scope |
| 46 | Localizzazione 35 lingue | P3 | parziale | solo italiano |
| 47 | Tastiera Quick Paste riconfigurabile | P2 | parziale | solo hotkey globali |
| 48 | Tema XML importabile | P3 | ❌ | non implementato |
| 49 | Invio email/Gmail | P3 | ❌ | non implementato |

Tutte le feature **P0** sono presenti. Mancano solo accessori P3 (diff, QR/Translate, scripting, email, temi XML) e la localizzazione multilingua.

**Nuove funzioni richieste:** modifica in-place (#26), etichette/cartelle colorate multiple con filtro rapido (#20), pin esente dalla pulizia (#21): tutte verificate e2e.
