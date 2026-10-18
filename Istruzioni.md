# MISSIONE
Costruisci da zero, in questa cartella di lavoro, una nuova versione di **Ditto**, il gestore di clipboard per Windows. L'originale è installato in `C:\Program Files\Ditto`. Il risultato deve essere un'app che replica tutte le funzionalità core di Ditto, con un design di livello superiore e tre funzionalità inedite.

# SKILL DA USARE (obbligatorio, caricale prima di iniziare)
- `caveman`: per comunicare con me in modo essenziale; niente preamboli, niente riepiloghi superflui.
- `impeccable`: per la qualità di codice, rifiniture e cura dei dettagli.
- `design taste skill`: per le decisioni di UX/UI, tipografia, spaziatura, colore e gerarchia visiva.

# FASE 1: REVERSE ENGINEERING DI DITTO (usa REA)
Usa REA per analizzare `C:\Program Files\Ditto` e documentare:
1. Funzionalità: cattura clipboard (testo, immagini, file, RTF/HTML), cronologia, ricerca, hotkey globale, incolla rapido, gruppi, sincronizzazione, limiti e retention, esclusione di applicazioni.
2. Modello dati: schema del database, tipi di record, metadati.
3. Flussi utente: apertura, ricerca, selezione, incolla, gestione dei record.
4. Impostazioni e scorciatoie.

Output della fase: `docs/ditto-analysis.md` con la lista di feature e una matrice di parità (feature → priorità → stato). Non scrivere codice prima di aver completato questo documento.

# FASE 2: PROGETTAZIONE
- Proponi stack tecnologico e architettura con motivazioni (privilegia un'app desktop nativa o leggera, con avvio rapido e basso consumo di memoria).
- Definisci un design system: palette, tipografia, spaziatura, componenti, stati (hover, focus, selezione), modalità chiara e scura, animazioni sobrie.
- Salva tutto in `docs/design-system.md`.

# FASE 3: IMPLEMENTAZIONE
**Parità con Ditto**: implementa tutte le funzionalità core individuate nella fase 1.

**Nuove funzionalità (requisiti obbligatori):**
1. **Modifica in-place**: modifica diretta del contenuto di un record dalla clipboard, senza passare da finestre esterne, con salvataggio e annullamento.
2. **Etichette e cartelle colorate**: organizzazione dei record in cartelle o etichette, ciascuna con un colore distintivo, assegnazione multipla, filtro rapido per etichetta.
3. **Pin dei record**: i record pinnati restano sempre in evidenza in cima alla lista e non vengono rimossi dalla pulizia automatica della cronologia.

**Requisiti di design:**
- Aspetto moderno e innovativo, come se fosse stato ideato da un UX/UI designer professionista.
- Interazione fluida da tastiera, risposta immediata, nessun elemento superfluo.

# FASE 4: VERIFICA
- Esegui l'app, testa ogni feature e ogni flusso, e correggi i bug.
- Controlla la matrice di parità: nessuna feature core deve restare mancante.
- Verifica la coerenza visiva con il design system.

# REGOLE DI LAVORO
- Procedi in autonomia: fai domande solo per decisioni irreversibili o ambigue, altrimenti scegli un default sensato e annotalo.
- Lavora per fasi e committa o salva a ogni milestone.
- Mantieni aggiornato un file `README.md` con istruzioni di build e avvio.
- A fine lavoro dammi: cosa è stato fatto, come avviarlo e le eventuali limitazioni note.