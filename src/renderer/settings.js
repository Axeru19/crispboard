import { $, $$, esc, fmtBytes, api } from './util.js';
import { showMenu, toast } from './ui.js';

const SECTIONS = [
  {
    id: 'general', title: 'Generale', icon: 'gear-six', lede: 'Come si apre Crispboard e quando parte.',
    groups: [
      { title: 'Apertura', fields: [
        { key: 'hotkey', type: 'hotkey', label: 'Scorciatoia globale', hint: 'Apre o chiude Crispboard da qualsiasi applicazione.' },
        { key: 'position', type: 'select', label: 'Posizione della finestra', options: [['caret', 'Accanto al cursore di testo'], ['cursor', 'Accanto al puntatore'], ['last', 'Ultima posizione']] },
        { key: 'hideOnBlur', type: 'bool', label: 'Chiudi quando perde il focus' },
      ] },
      { title: 'Avvio', fields: [
        { key: 'startWithWindows', type: 'bool', label: 'Avvia con Windows' },
        { key: 'showTray', type: 'bool', label: 'Mostra icona nell’area di notifica' },
      ] },
      { title: 'Scorciatoie rapide', fields: [
        { key: 'globalLastTen', type: 'bool', label: 'Incolla le ultime dieci clip con una scorciatoia globale', hint: 'Modificatore + 1…9, 0 incolla direttamente la clip n-esima.' },
        { key: 'globalLastTenModifier', type: 'text', label: 'Modificatore', hint: 'Esempio: Ctrl+Alt' },
      ] },
    ],
  },
  {
    id: 'history', title: 'Cronologia', icon: 'clock-counter-clockwise', lede: 'Cosa viene salvato e per quanto tempo. Le clip fissate non vengono mai eliminate.',
    groups: [
      { title: 'Limiti', fields: [
        { key: 'maxEntries', type: 'number', label: 'Numero massimo di clip', hint: '0 = nessun limite. Pin e clip “non eliminare” sono esclusi dal conteggio.', min: 0, max: 100000 },
        { key: 'expireDays', type: 'number', label: 'Elimina dopo (giorni)', hint: '0 = mai. Conta dall’ultimo utilizzo.', min: 0, max: 3650 },
        { key: 'maxClipBytes', type: 'number', label: 'Dimensione massima clip (byte)', hint: '0 = nessun limite.', min: 0 },
        { key: 'descChars', type: 'number', label: 'Caratteri salvati nella descrizione', min: 50, max: 5000 },
      ] },
      { title: 'Duplicati', fields: [
        { key: 'allowDuplicates', type: 'bool', label: 'Consenti duplicati', hint: 'Se disattivato, copiare di nuovo lo stesso contenuto lo riporta in cima.' },
        { key: 'duplicateWindowMs', type: 'number', label: 'Ignora copie ripetute entro (ms)', min: 0, max: 60000 },
      ] },
      { title: 'Applicazioni e privacy', fields: [
        { key: 'respectPrivacyFormats', type: 'bool', label: 'Rispetta i contenuti marcati come privati', hint: 'I gestori di password che lo dichiarano non vengono registrati.' },
        { key: 'excludeApps', type: 'list', label: 'Applicazioni escluse', hint: 'Un eseguibile per riga, ad esempio keepass.exe.' },
        { key: 'includeApps', type: 'list', label: 'Salva solo da queste applicazioni', hint: 'Lascia vuoto per salvare da tutte.' },
      ] },
      { title: 'Cattura', fields: [
        { key: 'connected', type: 'bool', label: 'Cattura attiva', hint: 'Sospendila per non registrare le copie.' },
      ] },
    ],
  },
  {
    id: 'paste', title: 'Incolla', icon: 'arrow-elbow-down-left', lede: 'Cosa succede quando scegli una clip.',
    groups: [
      { title: 'Comportamento', fields: [
        { key: 'updateOrderOnPaste', type: 'bool', label: 'Porta in cima la clip incollata' },
        { key: 'pasteDelayMs', type: 'number', label: 'Attesa prima di incollare (ms)', hint: 'Aumentala se alcune applicazioni incollano il contenuto precedente.', min: 0, max: 1000 },
        { key: 'confirmDelete', type: 'bool', label: 'Chiedi conferma prima di eliminare' },
      ] },
      { title: 'Incolla multiplo', fields: [
        { key: 'multiSeparator', type: 'text', label: 'Separatore', hint: 'Usa \\n per andare a capo e \\t per la tabulazione.' },
        { key: 'multiReverse', type: 'bool', label: 'Ordine inverso' },
      ] },
    ],
  },
  {
    id: 'look', title: 'Aspetto', icon: 'palette', lede: 'Segue il tema di Windows, a meno che tu non scelga diversamente.',
    groups: [
      { title: 'Tema', fields: [
        { key: 'theme', type: 'select', label: 'Tema', options: [['system', 'Segui Windows'], ['light', 'Chiaro'], ['dark', 'Scuro']] },
        { key: 'transparency', type: 'number', label: 'Trasparenza finestra (%)', min: 0, max: 60 },
      ] },
      { title: 'Lista', fields: [
        { key: 'linesPerRow', type: 'number', label: 'Righe di testo per clip', min: 1, max: 5 },
        { key: 'layout', type: 'select', label: 'Layout', hint: 'Posizione dell’anteprima. Si cambia anche dal pulsante in alto nella finestra.', options: [['auto', 'Automatico'], ['side', 'Anteprima a destra'], ['stack', 'Anteprima sotto'], ['list', 'Solo lista']] },
        { key: 'showIndexes', type: 'bool', label: 'Mostra i numeri Ctrl+1…0' },
        { key: 'markPasted', type: 'bool', label: 'Segna le clip già incollate' },
      ] },
      { title: 'Finestra', fields: [
        { key: 'alwaysOnTop', type: 'bool', label: 'Sempre in primo piano' },
        { key: 'showInTaskbar', type: 'bool', label: 'Mostra nella barra delle applicazioni' },
      ] },
    ],
  },
  {
    id: 'buffers', title: 'Buffer di copia', icon: 'copy', lede: 'Tre slot indipendenti: copia o taglia nell’app attiva e incolla dallo slot con una scorciatoia globale. Premi Backspace in un campo per svuotarlo.',
    groups: [1, 2, 3].map((n) => ({ title: `Buffer ${n}`, fields: [
      { key: `cbCopy${n}`, type: 'hotkey', label: 'Copia nel buffer' },
      { key: `cbCut${n}`, type: 'hotkey', label: 'Taglia nel buffer' },
      { key: `cbPaste${n}`, type: 'hotkey', label: 'Incolla dal buffer' },
    ] })),
  },
  { id: 'sync', title: 'Sincronizzazione', icon: 'export', custom: 'sync' },
  { id: 'labels', title: 'Etichette', icon: 'tag', custom: 'labels' },
  { id: 'data', title: 'Dati', icon: 'database', custom: 'data' },
  { id: 'about', title: 'Informazioni', icon: 'info', custom: 'about' },
];

const state = { settings: {}, meta: {}, section: new URLSearchParams(location.search).get('tab') || 'general' };
const content = $('#content');

function accel(e) {
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key) || !mods.length) return null;
  let k = e.key.length === 1 ? e.key.toUpperCase() : e.key.replace('Arrow', '');
  if (k === ' ') k = 'Space';
  return [...mods, k].join('+');
}

function fieldHtml(f) {
  const v = state.settings[f.key];
  let ctl;
  if (f.type === 'bool') ctl = `<input class="switch" type="checkbox" role="switch" id="f-${f.key}" data-key="${f.key}" ${v ? 'checked' : ''}>`;
  else if (f.type === 'number') ctl = `<input type="number" id="f-${f.key}" data-key="${f.key}" value="${esc(v)}" min="${f.min ?? ''}" max="${f.max ?? ''}">`;
  else if (f.type === 'text') ctl = `<input type="text" id="f-${f.key}" data-key="${f.key}" value="${esc(v)}">`;
  else if (f.type === 'hotkey') ctl = `<input class="hk" type="text" id="f-${f.key}" data-key="${f.key}" data-hk="1" value="${esc(v)}" readonly placeholder="Premi una combinazione">`;
  else if (f.type === 'select') ctl = `<select id="f-${f.key}" data-key="${f.key}">${f.options.map(([val, l]) => `<option value="${val}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (f.type === 'list') ctl = `<textarea id="f-${f.key}" data-key="${f.key}" data-list="1" spellcheck="false">${esc((v || []).join('\n'))}</textarea>`;
  const stack = f.type === 'list';
  return `<div class="field${stack ? ' stack' : ''}"><label class="lbl" for="f-${f.key}">${esc(f.label)}</label>
    <div class="ctl">${ctl}</div>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
}

async function renderLabels(sec) {
  const labels = await api('labels:list');
  content.innerHTML = `<h1>${sec.title}</h1><p class="lede">Raggruppa le clip con etichette colorate. Una clip può averne più di una; nella finestra principale puoi filtrare con un clic o con Alt+1…8.</p>
    <div class="fgroup" id="lbls">${labels.length ? labels.map((l) => `
      <div class="lbl-row" data-id="${l.id}">
        <button type="button" class="sw" style="--c:${esc(l.color)}" data-act="color" aria-label="Cambia colore di ${esc(l.name)}"></button>
        <input type="text" value="${esc(l.name)}" data-act="rename" aria-label="Nome etichetta">
        <span class="count">${l.count} clip</span>
        <button type="button" class="icon-btn" data-act="delete" aria-label="Elimina ${esc(l.name)}">${window.icon('trash')}</button>
      </div>`).join('') : '<p class="note">Nessuna etichetta. Creane una qui sotto.</p>'}</div>
    <div class="btns"><button type="button" class="btn primary" id="new-label">${window.icon('plus')}Nuova etichetta</button></div>
    <p class="note">Eliminando un’etichetta le clip restano: viene rimossa solo l’assegnazione.</p>`;
}

function renderSync(sec) {
  const f = state.settings.friends || [];
  content.innerHTML = `<h1>${sec.title}</h1><p class="lede">Invia clip ad altri PC della rete locale. Il traffico è cifrato (AES-256-GCM) con una password condivisa; chi non la conosce non può inviare né leggere nulla.</p>
    <div class="fgroup"><h2>Ricezione</h2>
      ${fieldHtml({ key: 'syncReceive', type: 'bool', label: 'Ricevi clip da altri PC', hint: 'Apre la porta indicata sulla rete locale. Windows potrebbe chiedere l’autorizzazione del firewall.' })}
      ${fieldHtml({ key: 'syncPort', type: 'number', label: 'Porta', min: 1024, max: 65535 })}
      ${fieldHtml({ key: 'syncPassword', type: 'text', label: 'Password condivisa', hint: 'Deve essere identica su tutti i PC.' })}
      ${fieldHtml({ key: 'syncAcceptToClipboard', type: 'bool', label: 'Metti negli appunti le clip ricevute dagli amici', hint: 'Le clip da altri indirizzi vengono solo salvate nella cronologia.' })}
    </div>
    <div class="fgroup"><h2>Amici</h2>
      ${f.length ? f.map((x, i) => `<div class="lbl-row friend" data-i="${i}" style="grid-template-columns:minmax(0,1fr) minmax(0,1.2fr) 80px auto auto auto">
        <input type="text" value="${esc(x.name)}" data-fk="name" placeholder="Nome" aria-label="Nome">
        <input type="text" value="${esc(x.host)}" data-fk="host" placeholder="Indirizzo IP o nome PC" aria-label="Indirizzo">
        <input type="number" value="${esc(x.port || 23443)}" data-fk="port" aria-label="Porta">
        <label style="font-size:12px;color:var(--text-2);display:flex;gap:6px;align-items:center"><input class="switch" type="checkbox" role="switch" data-fk="sendAll" ${x.sendAll ? 'checked' : ''}>Invia tutto</label>
        <button type="button" class="btn" data-fa="test">Prova</button>
        <button type="button" class="icon-btn" data-fa="del" aria-label="Rimuovi">${window.icon('trash')}</button></div>`).join('') : '<p class="note">Nessun amico. Aggiungine uno per inviargli le clip dal menu contestuale.</p>'}
      <div class="btns"><button type="button" class="btn primary" id="add-friend">${window.icon('plus')}Aggiungi amico</button></div>
      <p class="note">“Invia tutto” spedisce automaticamente ogni nuova copia a quel PC.</p></div>`;
}

async function saveFriends(mut) {
  const friends = JSON.parse(JSON.stringify(state.settings.friends || []));
  mut(friends);
  await save('friends', friends);
}

async function renderData(sec) {
  const s = await api('data:stats');
  content.innerHTML = `<h1>${sec.title}</h1><p class="lede">Database e manutenzione. Percorso: <code>${esc(state.meta.dbPath)}</code></p>
    <div class="stats"><div><b>${s.clips}</b><span>clip</span></div><div><b>${s.pinned}</b><span>fissate</span></div>
    <div><b>${s.labels}</b><span>etichette</span></div><div><b>${s.pastes}</b><span>incolla</span></div>
    <div><b>${fmtBytes(s.dataBytes)}</b><span>dati</span></div><div><b>${fmtBytes(s.fileBytes)}</b><span>file database</span></div></div>
    <div class="fgroup"><h2>Esporta e importa</h2><div class="btns">
      <button type="button" class="btn" data-d="export">${window.icon('export')}Esporta cronologia</button>
      <button type="button" class="btn" data-d="import">${window.icon('tray-arrow-down')}Importa file</button>
      <button type="button" class="btn" data-d="ditto">${window.icon('tray-arrow-down')}Importa da Ditto</button></div>
      <p class="note">Il database di Ditto si trova di solito in <code>%APPDATA%\Ditto\Ditto.db</code>. Vengono importati testo, HTML, RTF, immagini e file; i gruppi diventano etichette, le clip sticky diventano pin. Ditto non viene modificato.</p></div>
    <div class="fgroup"><h2>Backup</h2><div class="btns">
      <button type="button" class="btn" data-d="backup">${window.icon('download-simple')}Crea backup</button>
      <button type="button" class="btn" data-d="restore">${window.icon('arrow-counter-clockwise')}Ripristina backup</button>
      <button type="button" class="btn" data-d="compact">Compatta database</button></div></div>
    <div class="fgroup"><h2>Pulizia</h2><div class="btns">
      <button type="button" class="btn" data-d="unused">Elimina le clip mai incollate</button>
      <button type="button" class="btn danger" data-d="clear">Svuota cronologia (mantieni i pin)</button></div>
      <p class="note">Le clip fissate o con etichetta non vengono toccate dall’eliminazione delle clip mai incollate.</p></div>`;
}

function renderAbout(sec) {
  content.innerHTML = `<h1>${sec.title}</h1><p class="lede">Crispboard ${esc(state.meta.version)}: gestore di clipboard per Windows, ispirato a Ditto.</p>
    <div class="fgroup"><h2>Scorciatoie nella finestra</h2>
    ${[
      ['↑ ↓ PagSu PagGiù', 'Naviga'], ['Invio', 'Incolla'], ['Maiusc+Invio', 'Incolla come testo semplice'],
      ['Ctrl+1…0', 'Incolla la clip in posizione 1…10'], ['Ctrl+E / F2', 'Modifica la clip sul posto'],
      ['Ctrl+Invio', 'Salva la modifica'], ['Ctrl+P', 'Fissa o sblocca'], ['Ctrl+L', 'Assegna etichette'],
      ['Alt+1…8', 'Filtra per etichetta'], ['Alt+↑ / Alt+↓', 'Sposta la clip'], ['Ctrl+D / Canc', 'Elimina'],
      ['Ctrl+N', 'Nuova clip'], ['F3', 'Mostra o nascondi anteprima'], ['Tab', 'Sposta il focus sull’anteprima'], ['Esc', 'Annulla, svuota la ricerca, chiudi'],
    ].map(([k, t]) => `<div class="field"><span class="lbl">${t}</span><kbd>${esc(k)}</kbd></div>`).join('')}</div>`;
}

function renderSection() {
  const sec = SECTIONS.find((s) => s.id === state.section) || SECTIONS[0];
  $$('#side button').forEach((b) => b.setAttribute('aria-current', b.dataset.id === sec.id ? 'page' : 'false'));
  if (sec.custom === 'labels') return renderLabels(sec);
  if (sec.custom === 'sync') return renderSync(sec);
  if (sec.custom === 'data') return renderData(sec);
  if (sec.custom === 'about') return renderAbout(sec);
  content.innerHTML = `<h1>${sec.title}</h1><p class="lede">${esc(sec.lede)}</p>` +
    sec.groups.map((g) => `<div class="fgroup"><h2>${esc(g.title)}</h2>${g.fields.map(fieldHtml).join('')}</div>`).join('');
  return null;
}

function parseValue(t) {
  if (t.type === 'checkbox') return t.checked;
  if (t.type === 'number') return Number(t.value || 0);
  if (t.dataset.list) return t.value.split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  return t.value;
}

async function save(key, value) {
  state.settings = await api('settings:set', { [key]: value });
}

content.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.fk) {
    const i = Number(t.closest('.friend').dataset.i);
    saveFriends((fr) => { fr[i][t.dataset.fk] = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value.trim(); });
    return;
  }
  if (t.dataset.hk || !t.dataset.key) return;
  save(t.dataset.key, parseValue(t));
});
content.addEventListener('keydown', async (e) => {
  const t = e.target;
  if (!t.dataset?.hk) return;
  e.preventDefault();
  if (e.key === 'Backspace' || e.key === 'Delete') { t.value = ''; await save(t.dataset.key, ''); return; }
  const a = accel(e);
  if (!a) return;
  t.value = a;
  await save(t.dataset.key, a);
  toast(`Scorciatoia impostata: ${a}`);
});

content.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-d],[data-fa],#new-label,#add-friend');
  if (!t) return;
  if (t.id === 'add-friend') { await saveFriends((fr) => fr.push({ name: '', host: '', port: 23443, sendAll: false })); renderSection(); return; }
  if (t.dataset.fa) {
    const i = Number(t.closest('.friend').dataset.i);
    if (t.dataset.fa === 'del') { await saveFriends((fr) => fr.splice(i, 1)); renderSection(); return; }
    try { await api('sync:test', i); } catch (err) { toast(`Connessione non riuscita: ${err.message}`, 'error'); }
    return;
  }
  if (t.id === 'new-label') {
    const labels = await api('labels:list');
    await api('labels:create', { name: `Etichetta ${labels.length + 1}` });
    renderSection();
    return;
  }
  const row = t.closest('.lbl-row');
  if (t.dataset.act === 'delete' && row) { await api('labels:delete', Number(row.dataset.id)); renderSection(); return; }
  if (t.dataset.act === 'color' && row) {
    const r = t.getBoundingClientRect();
    showMenu(state.meta.labelColors.map((c) => ({
      label: ' ', dot: c, onClick: async () => { await api('labels:update', { id: Number(row.dataset.id), color: c }); renderSection(); },
    })), r.left, r.bottom + 4);
    return;
  }
  switch (t.dataset.d) {
    case 'export': await api('data:export'); break;
    case 'import': await api('data:import'); renderSection(); break;
    case 'ditto': await api('data:import', { ditto: true }); renderSection(); break;
    case 'backup': await api('data:backup'); break;
    case 'restore': await api('data:restore'); break;
    case 'compact': await api('data:compact'); renderSection(); break;
    case 'unused': await api('data:delete-unused'); renderSection(); break;
    case 'clear':
      if (window.confirm('Eliminare tutta la cronologia? Le clip fissate restano.')) { const n = await api('data:clear', { keepPinned: true }); toast(`Eliminate ${n} clip`); renderSection(); }
      break;
    default:
  }
});
content.addEventListener('focusout', async (e) => {
  const t = e.target;
  if (t.dataset?.act === 'rename') {
    const row = t.closest('.lbl-row');
    const name = t.value.trim();
    if (name) { try { await api('labels:update', { id: Number(row.dataset.id), name }); } catch { toast('Nome già in uso', 'error'); renderSection(); } }
  }
});
content.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset?.act === 'rename') e.target.blur(); });

async function init() {
  state.meta = await api('settings:meta');
  state.settings = await api('settings:get');
  $('#side').innerHTML = '<div class="brand">Crispboard</div>' +
    SECTIONS.map((s) => `<button type="button" data-id="${s.id}">${window.icon(s.icon)}${esc(s.title)}</button>`).join('');
  $('#side').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { state.section = b.dataset.id; renderSection(); content.scrollTop = 0; }
  });
  window.crisp.on('settings:tab', (tab) => { state.section = tab; renderSection(); });
  window.crisp.on('toast', ({ message, kind }) => toast(message, kind));
  window.crisp.on('list:changed', () => { if (['labels', 'data'].includes(state.section)) renderSection(); });
  renderSection();
}
init();
