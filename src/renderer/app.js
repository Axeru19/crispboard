import { $, $$, esc, highlight, relTime, fmtBytes, looksLikeCode, isUrl, appLabel, api } from './util.js';
import { showMenu, closeMenus, menuOpen, toast, showLabelPicker } from './ui.js';
import { accelFromEvent, isUnsupported } from './accel.js';

const PAGE = 200;
const LAYOUTS = [['auto', 'Automatico', 'layout'], ['side', 'Anteprima a destra', 'columns'], ['stack', 'Anteprima sotto', 'rows'], ['list', 'Solo lista', 'list']];

const state = {
  rows: [],
  total: 0,
  cursor: 0,
  selected: new Set(),
  anchor: 0,
  query: '',
  mode: 'contains',
  labelFilter: new Set(),
  labels: [],
  settings: {},
  meta: { transforms: [], labelColors: [] },
  detail: null,
  pvView: 'auto',
  editing: false,
  editDirty: false,
  escArmed: false,
  loadingMore: false,
};

const el = {
  win: $('#win'), q: $('#q'), count: $('#count'), list: $('#list'), preview: $('#preview'),
  hints: $('#hints'), labelbar: $('#labelbar'), body: $('#body'), modes: $('#modes'),
};

const ic = (n, c) => window.icon(n, c);
const labelById = (id) => state.labels.find((l) => l.id === id);
const focusInput = () => { if (!state.editing) el.q.focus(); };
const current = () => state.rows[state.cursor] || null;
const targets = () => {
  if (state.selected.size > 1) return state.rows.filter((r) => state.selected.has(r.id)).map((r) => r.id);
  const c = current();
  return c ? [c.id] : [];
};

// ---------- dati ----------
let refreshSeq = 0;
async function refresh({ keepCursor = true } = {}) {
  const seq = ++refreshSeq;
  const keepId = keepCursor ? current()?.id : null;
  const res = await api('clips:list', {
    query: state.query, mode: state.mode, labelIds: [...state.labelFilter], limit: PAGE, offset: 0,
  });
  if (seq !== refreshSeq) return;
  state.rows = res.rows;
  state.total = res.total;
  state.error = res.error || null;
  const idx = keepId != null ? state.rows.findIndex((r) => r.id === keepId) : -1;
  state.cursor = idx >= 0 ? idx : 0;
  state.selected = new Set(state.rows[state.cursor] ? [state.rows[state.cursor].id] : []);
  state.anchor = state.cursor;
  renderList();
  renderCount();
  await loadDetail();
}

async function loadMore() {
  if (state.loadingMore || state.rows.length >= state.total) return;
  state.loadingMore = true;
  try {
    const res = await api('clips:list', {
      query: state.query, mode: state.mode, labelIds: [...state.labelFilter], limit: PAGE, offset: state.rows.length,
    });
    state.rows.push(...res.rows);
    renderList({ keepScroll: true });
  } finally { state.loadingMore = false; }
}

async function loadLabels() {
  state.labels = await api('labels:list');
  state.labelFilter = new Set([...state.labelFilter].filter((id) => labelById(id)));
  renderLabelbar();
}

async function loadDetail() {
  const c = current();
  if (!c) { state.detail = null; renderPreview(); return; }
  const id = c.id;
  const d = await api('clips:get', id);
  if (current()?.id !== id) return;
  state.detail = d;
  if (!state.editing) renderPreview();
}

// ---------- render: barra etichette ----------
function renderLabelbar() {
  const chips = state.labels.map((l, i) => `
    <button type="button" class="chip" style="--c:${esc(l.color)}" data-id="${l.id}" aria-pressed="${state.labelFilter.has(l.id)}"
      title="Filtra per ${esc(l.name)}${i < 8 ? ` (Alt+${i + 1})` : ''}">
      <span class="dot"></span><span>${esc(l.name)}</span><span class="n">${l.count}</span>
    </button>`).join('');
  el.labelbar.innerHTML = chips + `<button type="button" class="chip add" id="chip-add" title="Gestisci etichette (Ctrl+L)">${ic('plus')}${state.labels.length ? '' : '<span>Etichetta</span>'}</button>`;
  el.labelbar.style.display = '';
}

// ---------- render: lista ----------
function typeIcon(r, text) {
  if (r.kind === 'image') return 'image';
  if (r.kind === 'files') return 'files';
  if (isUrl(r.preview)) return 'link';
  if (looksLikeCode(text ?? r.preview)) return 'code';
  return 'text-t';
}

function rowHtml(r, i, pos) {
  const lines = Math.min(5, Math.max(1, state.settings.linesPerRow || 2));
  const dots = r.labels.map((id) => labelById(id)).filter(Boolean)
    .map((l) => `<i style="--c:${esc(l.color)}" title="${esc(l.name)}"></i>`).join('');
  const sel = state.selected.has(r.id);
  const isThumb = r.kind === 'image';
  const iconHtml = isThumb
    ? `<span class="ico thumb" style="background-image:url('crisp://thumb/${r.id}')"></span>`
    : `<span class="ico">${ic(typeIcon(r))}</span>`;
  const app = appLabel(r.source_app);
  const used = state.settings.markPasted && r.use_count > 0 ? '<span class="used" title="Già incollata"></span>' : '';
  const idx = state.settings.showIndexes && pos < 10 ? `<span class="idx" title="Ctrl+${(pos + 1) % 10}">${(pos + 1) % 10}</span>` : '<span></span>';
  return `<div class="row${r.pinned ? ' pinned' : ''}${sel && state.selected.size > 1 ? ' in-multi' : ''}" role="option" id="c${r.id}" data-i="${i}" data-id="${r.id}"
      aria-selected="${i === state.cursor || sel}" style="--lines:${lines}">
      ${iconHtml}
      <div class="rtext">
        <div class="line${looksLikeCode(r.preview) ? ' mono' : ''}">${highlight(r.preview || '(vuota)', state.query, state.mode)}</div>
        <div class="meta">${used}<span>${esc(relTime(r.created_at))}</span>${app ? `<span class="sep">/</span><span>${esc(app)}</span>` : ''}${r.edited ? '<span class="sep">/</span><span>modificata</span>' : ''}${r.quick_name ? `<span class="sep">/</span><span>${esc(r.quick_name)}</span>` : ''}${dots ? `<span class="dots">${dots}</span>` : ''}</div>
      </div>
      ${idx}
    </div>`;
}

function renderList({ keepScroll = false } = {}) {
  const top = el.list.scrollTop;
  if (!state.rows.length) {
    const filtering = state.query || state.labelFilter.size;
    el.list.innerHTML = state.error
      ? `<div class="empty">${ic('warning-circle')}<strong>${esc(state.error)}</strong>Correggi l'espressione per vedere i risultati.</div>`
      : filtering
        ? `<div class="empty">${ic('magnifying-glass')}<strong>Nessun risultato</strong>${state.query ? `per <span class="q">${esc(state.query)}</span>` : 'con le etichette selezionate'}</div>`
        : `<div class="empty">${ic('clipboard-text')}<strong>La cronologia è vuota</strong>Copia qualcosa: apparirà qui.</div>`;
    return;
  }
  const pinned = state.rows.filter((r) => r.pinned).length;
  let html = '';
  state.rows.forEach((r, i) => {
    if (pinned && i === 0) html += `<div class="group">${ic('push-pin-fill')}Fissate</div>`;
    if (pinned && i === pinned) html += '<div class="group">Recenti</div>';
    html += rowHtml(r, i, i);
  });
  if (state.rows.length < state.total) html += `<div class="group">${state.total - state.rows.length} altre: scorri per caricarle</div>`;
  el.list.innerHTML = html;
  if (keepScroll) el.list.scrollTop = top;
  else scrollToCursor();
}

function updateSelectionUi() {
  $$('.row', el.list).forEach((n) => {
    const i = Number(n.dataset.i);
    const sel = state.selected.has(state.rows[i]?.id);
    n.setAttribute('aria-selected', String(i === state.cursor || sel));
    n.classList.toggle('in-multi', sel && state.selected.size > 1);
  });
  const c = current();
  if (c) el.q.setAttribute('aria-activedescendant', `c${c.id}`);
}

function scrollToCursor() {
  const n = $(`.row[data-i="${state.cursor}"]`, el.list);
  if (!n) return;
  const lr = el.list.getBoundingClientRect();
  const nr = n.getBoundingClientRect();
  if (nr.top < lr.top + 28) el.list.scrollTop -= lr.top + 28 - nr.top;
  else if (nr.bottom > lr.bottom - 6) el.list.scrollTop += nr.bottom - lr.bottom + 6;
}

function renderCount() {
  el.count.textContent = state.query || state.labelFilter.size ? `${state.total}` : '';
  renderHints();
}

// ---------- render: anteprima ----------
function renderPreview() {
  const d = state.detail;
  const layout = state.settings.layout || 'auto';
  el.body.dataset.layout = layout;
  $('#btn-layout').innerHTML = ic(LAYOUTS.find(([k]) => k === layout)[2]);
  if (layout === 'list') return;
  if (!d) {
    el.preview.innerHTML = `<div class="empty">${ic('eye')}<strong>Nessuna selezione</strong></div>`;
    return;
  }
  const c = d.clip;
  const text = d.text;
  const hasHtml = !!d.html;
  const view = state.pvView === 'html' && hasHtml ? 'html' : 'text';
  const src = [appLabel(c.source_app), new Date(c.created_at).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' })].filter(Boolean);

  let body;
  if (c.kind === 'image') body = `<div class="pv-body imgwrap" tabindex="0"><img alt="Immagine copiata" src="crisp://img/${c.id}"></div>`;
  else if (c.kind === 'files') body = `<div class="pv-body" tabindex="0">${d.files.map((f) => `<div class="file">${ic('files')}<span>${esc(f)}</span></div>`).join('')}</div>`;
  else if (view === 'html') body = `<div class="pv-body imgwrap" tabindex="0"><iframe sandbox="" referrerpolicy="no-referrer" srcdoc="${esc(`<base target=_blank><style>body{font:14px system-ui;margin:12px;color:#222}</style>${d.html}`)}"></iframe></div>`;
  else body = `<div class="pv-body${looksLikeCode(text) ? ' mono' : ''}" tabindex="0">${esc(text ?? '')}${d.truncated ? '<div class="trunc">Anteprima troncata</div>' : ''}</div>`;

  const labelChips = c.labels.map((id) => labelById(id)).filter(Boolean).map((l) => `
    <span class="chip" style="--c:${esc(l.color)}" aria-pressed="true"><span class="dot"></span><span>${esc(l.name)}</span>
    <button type="button" class="x" data-unlabel="${l.id}" aria-label="Rimuovi ${esc(l.name)}">${ic('x')}</button></span>`).join('');

  el.preview.innerHTML = `
    <div class="pv-main">
      <div class="pv-head">
        <span class="grow">${esc(src.join(' · '))}</span>
        ${c.edited ? '<span class="badge">modificata</span>' : ''}
        <span>${fmtBytes(c.size)}</span>
        ${hasHtml && c.kind === 'text' ? `<span class="pv-tabs"><button type="button" data-view="text" aria-pressed="${view === 'text'}">Testo</button><button type="button" data-view="html" aria-pressed="${view === 'html'}">HTML</button></span>` : ''}
      </div>
      ${body}
    </div>
    <div class="pv-foot">
      <div class="pv-labels">${labelChips}<button type="button" class="chip add" data-act="labels">${ic('tag')}<span>Etichetta</span><kbd>Ctrl+L</kbd></button></div>
      <div class="pv-actions">
        <button type="button" class="btn primary" data-act="paste">Incolla <kbd>↵</kbd></button>
        ${c.kind === 'text' ? `<button type="button" class="btn" data-act="edit">${ic('pencil-simple')}Modifica <kbd>Ctrl+E</kbd></button>` : ''}
        <button type="button" class="btn" data-act="pin">${ic(c.pinned ? 'push-pin-fill' : 'push-pin')}${c.pinned ? 'Rimuovi pin' : 'Fissa'} <kbd>Ctrl+P</kbd></button>
        <button type="button" class="btn" data-act="props">${ic('sliders-horizontal')}Proprietà</button>
      </div>
      <div class="props" id="props" hidden>
        <label for="p-name">Nome rapido</label><input type="text" id="p-name" value="${esc(c.quick_name || '')}" placeholder="es. firma, iban">
        <label for="p-key">Scorciatoia globale</label><input type="text" id="p-key" value="${esc(c.hotkey || '')}" placeholder="premi una combinazione" readonly>
        <label for="p-keep">Non eliminare mai</label><input type="checkbox" id="p-keep" ${c.never_delete ? 'checked' : ''}>
      </div>
    </div>`;
}

function renderEditor() {
  const d = state.detail;
  const main = $('.pv-main', el.preview);
  if (!d || !main) return;
  main.innerHTML = `
    <div class="pv-head"><span class="grow">Modifica in-place</span><span class="badge" id="ed-badge">${state.editDirty ? 'modificato' : 'nessuna modifica'}</span></div>
    <textarea class="editor" id="editor" spellcheck="false" aria-label="Testo della clip"></textarea>`;
  const ta = $('#editor');
  ta.value = d.text ?? '';
  ta.addEventListener('input', () => {
    state.editDirty = ta.value !== (d.text ?? '');
    state.escArmed = false;
    $('#ed-badge').textContent = state.editDirty ? 'modificato' : 'nessuna modifica';
  });
  const foot = $('.pv-foot', el.preview);
  foot.innerHTML = `<div class="pv-actions">
    <button type="button" class="btn primary" data-act="save">${ic('floppy-disk')}Salva <kbd>Ctrl+↵</kbd></button>
    <button type="button" class="btn" data-act="cancel-edit">Annulla <kbd>Esc</kbd></button></div>`;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function renderHints() {
  const h = (k, t) => `<span class="h"><kbd>${k}</kbd>${t}</span>`;
  let left;
  if (state.editing) left = h('Ctrl+↵', 'Salva') + h('Esc', 'Annulla');
  else left = h('↵', 'Incolla') + h('⇧↵', 'Testo semplice') + h('Ctrl+E', 'Modifica') + h('Ctrl+P', 'Fissa') + h('Ctrl+L', 'Etichetta');
  const paused = state.settings.connected === false
    ? `<span class="paused">${ic('pause')}Cattura sospesa</span>` : '';
  const pos = state.rows.length ? `${state.cursor + 1} / ${state.total}` : '0';
  el.hints.innerHTML = `${left}<span class="grow"></span>${paused}<span class="status">${pos}</span>`;
}

// ---------- azioni ----------
async function pasteSelected({ plain = false, transform = null } = {}) {
  const ids = targets();
  if (!ids.length) return;
  await api('clips:paste', { ids, plain, transform });
}

async function pasteAt(n) {
  const r = state.rows[n];
  if (r) await api('clips:paste', { ids: [r.id] });
}

async function togglePin() {
  const ids = targets();
  const rows = state.rows.filter((r) => ids.includes(r.id));
  const pin = rows.some((r) => !r.pinned);
  for (const r of rows) await api('clips:pin', { id: r.id, pinned: pin });
  toast(pin ? 'Fissata in cima: non verrà più eliminata dalla pulizia' : 'Pin rimosso');
  await Promise.all([refresh(), loadLabels()]);
}

async function deleteSelected() {
  const ids = targets();
  if (!ids.length) return;
  if (state.settings.confirmDelete && !window.confirm(`Eliminare ${ids.length} clip?`)) return;
  const idx = state.cursor;
  await api('clips:delete', ids);
  await Promise.all([refresh({ keepCursor: false }), loadLabels()]);
  state.cursor = Math.min(idx, Math.max(0, state.rows.length - 1));
  state.selected = new Set(current() ? [current().id] : []);
  updateSelectionUi();
  await loadDetail();
  toast(ids.length > 1 ? `${ids.length} clip eliminate` : 'Clip eliminata');
}

async function startEdit() {
  const c = current();
  if (!c) return;
  if (c.kind !== 'text') { toast('Si possono modificare solo le clip di testo', 'error'); return; }
  if (!state.detail || state.detail.clip.id !== c.id) await loadDetail();
  if (state.detail?.truncated) { toast('Clip troppo lunga per la modifica in-place', 'error'); return; }
  state.editing = true;
  state.editDirty = false;
  state.escArmed = false;
  renderEditor();
  renderHints();
}

async function saveEdit() {
  const ta = $('#editor');
  const c = current();
  if (!ta || !c) return;
  await api('clips:update-text', { id: c.id, text: ta.value });
  state.editing = false;
  state.editDirty = false;
  toast('Modifica salvata');
  await refresh();
  focusInput();
}

function cancelEdit({ force = false } = {}) {
  if (!state.editing) return;
  if (state.editDirty && !force && !state.escArmed) {
    state.escArmed = true;
    toast('Modifiche non salvate: premi di nuovo Esc per scartarle');
    return;
  }
  state.editing = false;
  state.editDirty = false;
  state.escArmed = false;
  renderPreview();
  renderHints();
  focusInput();
}

async function newClip() {
  const id = await api('clips:new', '');
  state.query = '';
  el.q.value = '';
  state.labelFilter.clear();
  renderLabelbar();
  await refresh({ keepCursor: false });
  const i = state.rows.findIndex((r) => r.id === id);
  if (i >= 0) { moveCursor(i); await loadDetail(); }
  state.editing = true;
  renderEditor();
  renderHints();
}

async function moveClip(where) {
  const c = current();
  if (!c) return;
  await api('clips:move', { id: c.id, where });
  await refresh();
}

function openLabelPicker(anchor) {
  const ids = targets();
  if (!ids.length) { toast('Seleziona una clip'); return; }
  const r = (anchor || $('#btn-more')).getBoundingClientRect();
  const rows = state.rows.filter((x) => ids.includes(x.id));
  showLabelPicker({
    x: Math.min(r.left, window.innerWidth - 280), y: Math.max(40, r.top - 280),
    clipIds: ids, colors: state.meta.labelColors, getLabels: () => state.labels,
    assigned: (lid) => rows.length > 0 && rows.every((x) => x.labels.includes(lid)),
    onChange: async () => { await Promise.all([loadLabels(), refresh()]); },
    restoreFocus: focusInput,
  });
}

function openProps() {
  const p = $('#props');
  if (!p) return;
  p.hidden = !p.hidden;
  if (!p.hidden) $('#p-name').focus();
}

// ---------- menu contestuale ----------
function contextMenu(x, y) {
  const c = current();
  if (!c) return;
  const multi = targets().length > 1;
  const text = c.kind === 'text';
  const labelItems = state.labels.map((l) => ({
    label: l.name, dot: l.color, tick: c.labels.includes(l.id), keepOpen: false,
    onClick: async () => { await api('clips:labels', { ids: targets(), labelIds: [l.id], mode: 'toggle' }); await Promise.all([loadLabels(), refresh()]); },
  }));
  const items = [
    { label: multi ? `Incolla ${targets().length} clip` : 'Incolla', icon: 'arrow-elbow-down-left', shortcut: 'Invio', onClick: () => pasteSelected() },
    { label: 'Incolla come testo semplice', icon: 'text-aa', shortcut: 'Maiusc+Invio', onClick: () => pasteSelected({ plain: true }) },
  ];
  if (text) {
    items.push({ label: 'Incolla speciale', icon: 'text-t', submenu: state.meta.transforms.map(([k, label]) => ({ label, onClick: () => pasteSelected({ transform: k }) })) });
  }
  items.push(
    { label: 'Copia negli appunti', icon: 'copy', shortcut: 'Ctrl+C', onClick: copyToClipboard },
    { sep: true },
  );
  if (text && !multi) items.push({ label: 'Modifica', icon: 'pencil-simple', shortcut: 'Ctrl+E', onClick: startEdit });
  items.push({ label: c.pinned ? 'Rimuovi pin' : 'Fissa in cima', icon: 'push-pin', shortcut: 'Ctrl+P', onClick: togglePin });
  items.push({
    label: 'Etichette', icon: 'tag',
    submenu: [...labelItems, ...(labelItems.length ? [{ sep: true }] : []),
      { label: 'Gestisci etichette…', icon: 'plus', shortcut: 'Ctrl+L', onClick: () => openLabelPicker() }],
  });
  const friends = state.settings.friends || [];
  if (friends.length) {
    items.push({
      label: 'Invia a', icon: 'export',
      submenu: friends.map((f, i) => ({ label: f.name || f.host, onClick: () => api('sync:send', { friendIndex: i, ids: targets() }).catch((e) => toast(e.message, 'error')) })),
    });
  }
  if (!multi) {
    items.push({
      label: 'Ordine', icon: 'arrow-up',
      submenu: [
        { label: 'Sposta in cima', onClick: () => moveClip('top') }, { label: 'Sposta su', shortcut: 'Alt+↑', onClick: () => moveClip('up') },
        { label: 'Sposta giù', shortcut: 'Alt+↓', onClick: () => moveClip('down') }, { label: 'Sposta in fondo', onClick: () => moveClip('bottom') },
      ],
    });
    items.push({ label: 'Proprietà', icon: 'sliders-horizontal', onClick: openProps });
  }
  items.push({ sep: true });
  if (c.kind === 'image') items.push({ label: 'Salva immagine…', icon: 'download-simple', onClick: () => api('clips:export-image', c.id) });
  if (text) items.push({ label: 'Esporta come testo…', icon: 'export', onClick: () => api('clips:export-text', targets()) });
  items.push({ label: 'Elimina', icon: 'trash', shortcut: 'Ctrl+D', danger: true, onClick: deleteSelected });
  showMenu(items, x, y, { restoreFocus: focusInput });
}

function moreMenu() {
  const r = $('#btn-more').getBoundingClientRect();
  showMenu([
    { label: 'Nuova clip', icon: 'plus', shortcut: 'Ctrl+N', onClick: newClip },
    { label: state.settings.connected === false ? 'Riprendi cattura' : 'Sospendi cattura', icon: state.settings.connected === false ? 'play' : 'pause', onClick: () => api('clipboard:toggle') },
    { sep: true },
    { label: 'Esporta cronologia…', icon: 'export', onClick: () => api('data:export') },
    { label: 'Importa… (Ditto o Crispboard)', icon: 'tray-arrow-down', onClick: () => api('data:import') },
    { sep: true },
    { label: 'Impostazioni', icon: 'gear-six', shortcut: 'Ctrl+,', onClick: () => api('window:settings') },
    { label: 'Esci da Crispboard', icon: 'x', onClick: () => api('app:quit') },
  ], r.right - 230, r.bottom + 4, { restoreFocus: focusInput });
}

async function copyToClipboard() {
  const c = current();
  if (!c) return;
  await api('clips:copy', { id: c.id });
  toast('Copiata negli appunti');
}

// ---------- navigazione ----------
function moveCursor(i, { extend = false } = {}) {
  if (!state.rows.length) return;
  i = Math.max(0, Math.min(state.rows.length - 1, i));
  if (extend) {
    const [a, b] = [Math.min(state.anchor, i), Math.max(state.anchor, i)];
    state.selected = new Set(state.rows.slice(a, b + 1).map((r) => r.id));
  } else {
    state.anchor = i;
    state.selected = new Set([state.rows[i].id]);
  }
  state.cursor = i;
  updateSelectionUi();
  scrollToCursor();
  renderHints();
  loadDetail();
  if (i > state.rows.length - 20) loadMore();
}

function toggleLabelFilter(id) {
  if (state.labelFilter.has(id)) state.labelFilter.delete(id); else state.labelFilter.add(id);
  renderLabelbar();
  refresh({ keepCursor: false });
}

function setMode(mode) {
  state.mode = mode;
  $$('button', el.modes).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  api('settings:set', { searchMode: mode });
  refresh({ keepCursor: false });
}

// ---------- eventi ----------
let searchTimer = null;
el.q.addEventListener('input', () => {
  state.query = el.q.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refresh({ keepCursor: false }), 60);
});

el.modes.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { setMode(b.dataset.mode); focusInput(); } });
el.labelbar.addEventListener('click', (e) => {
  if (e.target.closest('#chip-add')) { openLabelPicker($('#chip-add')); return; }
  const c = e.target.closest('.chip[data-id]');
  if (c) { toggleLabelFilter(Number(c.dataset.id)); focusInput(); }
});
function layoutMenu() {
  const r = $('#btn-layout').getBoundingClientRect();
  const cur = state.settings.layout || 'auto';
  showMenu(LAYOUTS.map(([k, label, icon]) => ({ label, icon, tick: k === cur, onClick: () => api('settings:set', { layout: k }) })),
    r.right - 220, r.bottom + 4, { restoreFocus: focusInput });
}
$('#btn-layout').addEventListener('click', layoutMenu);
$('#btn-more').addEventListener('click', moreMenu);

el.list.addEventListener('mousedown', (e) => { if (e.target.closest('.row')) e.preventDefault(); });
el.list.addEventListener('click', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const i = Number(row.dataset.i);
  if (e.ctrlKey) {
    const id = state.rows[i].id;
    if (state.selected.has(id) && state.selected.size > 1) state.selected.delete(id); else state.selected.add(id);
    state.cursor = i; state.anchor = i;
    updateSelectionUi(); renderHints(); loadDetail();
  } else if (e.shiftKey) moveCursor(i, { extend: true });
  else moveCursor(i);
  focusInput();
});
el.list.addEventListener('dblclick', (e) => { if (e.target.closest('.row')) pasteSelected(); });
el.list.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('.row');
  if (!row) return;
  const i = Number(row.dataset.i);
  if (!state.selected.has(state.rows[i].id)) moveCursor(i);
  else { state.cursor = i; updateSelectionUi(); }
  contextMenu(e.clientX, e.clientY);
});
el.list.addEventListener('scroll', () => {
  if (el.list.scrollTop + el.list.clientHeight > el.list.scrollHeight - 200) loadMore();
});

el.preview.addEventListener('click', async (e) => {
  const un = e.target.closest('[data-unlabel]');
  if (un) { await api('clips:labels', { ids: [current().id], labelIds: [Number(un.dataset.unlabel)], mode: 'remove' }); await Promise.all([loadLabels(), refresh()]); return; }
  const v = e.target.closest('[data-view]');
  if (v) { state.pvView = v.dataset.view; renderPreview(); return; }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  switch (a.dataset.act) {
    case 'paste': pasteSelected(); break;
    case 'edit': startEdit(); break;
    case 'pin': togglePin(); break;
    case 'labels': openLabelPicker(a); break;
    case 'props': openProps(); break;
    case 'save': saveEdit(); break;
    case 'cancel-edit': cancelEdit({ force: true }); break;
    default:
  }
});
el.preview.addEventListener('change', async (e) => {
  const c = current();
  if (!c) return;
  if (e.target.id === 'p-name') { await api('clips:set-meta', { id: c.id, meta: { quick_name: e.target.value.trim() || null } }); refresh(); }
  if (e.target.id === 'p-keep') { await api('clips:set-meta', { id: c.id, meta: { never_delete: e.target.checked ? 1 : 0 } }); }
});
el.preview.addEventListener('keydown', async (e) => {
  if (e.target.id !== 'p-key') return;
  e.preventDefault();
  if (e.key === 'Backspace' || e.key === 'Delete') { e.target.value = ''; await api('clips:set-meta', { id: current().id, meta: { hotkey: null } }); return; }
  const acc = accelFromEvent(e);
  if (!acc) { if (isUnsupported(e)) toast('Questo tasto non può essere usato in una scorciatoia', 'error'); return; }
  e.target.value = acc;
  await api('clips:set-meta', { id: current().id, meta: { hotkey: acc } });
  toast(`Scorciatoia globale: ${acc}`);
});

document.addEventListener('keydown', async (e) => {
  if (menuOpen()) return;
  const k = e.key;
  const ctrl = e.ctrlKey || e.metaKey;
  const inEditor = e.target.id === 'editor';
  const inProps = e.target.closest?.('.props');

  if (state.editing) {
    if (k === 'Enter' && ctrl) { e.preventDefault(); saveEdit(); }
    else if (k === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (k === 's' && ctrl) { e.preventDefault(); saveEdit(); }
    return;
  }
  if (inProps && k !== 'Escape') return;

  if (k === 'Escape') {
    e.preventDefault();
    if (inProps) { $('#props').hidden = true; focusInput(); }
    else if (state.query) { el.q.value = ''; state.query = ''; refresh({ keepCursor: false }); }
    else if (state.labelFilter.size) { state.labelFilter.clear(); renderLabelbar(); refresh({ keepCursor: false }); }
    else api('window:hide');
    return;
  }
  if (ctrl && k === ',') { e.preventDefault(); api('window:settings'); return; }
  if (k === 'F3') { e.preventDefault(); api('settings:set', { layout: state.settings.layout === 'list' ? 'auto' : 'list' }); return; }

  if (k === 'ArrowDown') { e.preventDefault(); if (e.altKey) moveClip('down'); else moveCursor(state.cursor + 1, { extend: e.shiftKey }); }
  else if (k === 'ArrowUp') { e.preventDefault(); if (e.altKey) moveClip('up'); else moveCursor(state.cursor - 1, { extend: e.shiftKey }); }
  else if (k === 'PageDown') { e.preventDefault(); moveCursor(state.cursor + 8, { extend: e.shiftKey }); }
  else if (k === 'PageUp') { e.preventDefault(); moveCursor(state.cursor - 8, { extend: e.shiftKey }); }
  else if (k === 'Home' && (ctrl || e.altKey)) { e.preventDefault(); if (e.altKey) moveClip('top'); else moveCursor(0); }
  else if (k === 'End' && ctrl) { e.preventDefault(); moveCursor(state.rows.length - 1); }
  else if (k === 'Enter') { e.preventDefault(); pasteSelected({ plain: e.shiftKey }); }
  else if (ctrl && /^[0-9]$/.test(k)) { e.preventDefault(); pasteAt(k === '0' ? 9 : Number(k) - 1); }
  else if (e.altKey && /^[1-8]$/.test(k)) { e.preventDefault(); const l = state.labels[Number(k) - 1]; if (l) toggleLabelFilter(l.id); }
  else if (ctrl && k.toLowerCase() === 'e') { e.preventDefault(); startEdit(); }
  else if (k === 'F2') { e.preventDefault(); startEdit(); }
  else if (ctrl && k.toLowerCase() === 'p') { e.preventDefault(); togglePin(); }
  else if (ctrl && k.toLowerCase() === 'l') { e.preventDefault(); openLabelPicker(); }
  else if (ctrl && k.toLowerCase() === 'd') { e.preventDefault(); deleteSelected(); }
  else if (ctrl && k.toLowerCase() === 'n') { e.preventDefault(); newClip(); }
  else if (k === 'Delete' && !state.query) { e.preventDefault(); deleteSelected(); }
  else if (ctrl && k.toLowerCase() === 'c' && el.q.selectionStart === el.q.selectionEnd) { e.preventDefault(); copyToClipboard(); }
  else if (ctrl && k.toLowerCase() === 'a' && !state.query) { e.preventDefault(); state.selected = new Set(state.rows.map((r) => r.id)); updateSelectionUi(); }
  else if (k === 'F10' && e.shiftKey) { const n = $(`.row[data-i="${state.cursor}"]`); if (n) { const r = n.getBoundingClientRect(); contextMenu(r.left + 40, r.top + 20); } }
  else if (k === 'Tab' && !e.shiftKey) { const pb = $('.pv-body', el.preview); if (pb) { e.preventDefault(); pb.focus(); } }
  else return;
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && e.target.classList?.contains('pv-body')) { e.preventDefault(); focusInput(); }
}, true);

// ---------- eventi dal main ----------
window.crisp.on('list:changed', () => { if (!state.editing) { refresh(); loadLabels(); } });
window.crisp.on('toast', ({ message, kind }) => toast(message, kind));
window.crisp.on('settings:changed', (s) => applySettings(s));
window.crisp.on('popup:show', () => {
  closeMenus();
  state.editing = false;
  state.query = '';
  el.q.value = '';
  state.labelFilter.clear();
  state.pvView = 'auto';
  el.win.classList.remove('appear');
  void el.win.offsetWidth;
  el.win.classList.add('appear');
  renderLabelbar();
  refresh({ keepCursor: false }).then(() => { el.list.scrollTop = 0; });
  loadLabels();
  focusInput();
});
window.crisp.on('popup:hide', () => { closeMenus(); state.editing = false; });

function applySettings(s) {
  state.settings = s;
  state.mode = s.searchMode || 'contains';
  $$('button', el.modes).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
  renderList({ keepScroll: true });
  renderPreview();
  renderHints();
}

// ---------- avvio ----------
async function init() {
  $('#ic-search').innerHTML = ic('magnifying-glass');
  $('#btn-more').innerHTML = ic('dots-three');
  state.meta = await api('settings:meta');
  state.settings = await api('settings:get');
  state.mode = state.settings.searchMode || 'contains';
  $$('button', el.modes).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.mode)));
  await loadLabels();
  await refresh({ keepCursor: false });
  focusInput();
}
init();
