import { $, esc, api } from './util.js';

const layer = () => $('#layer');

export function closeMenus() { layer().innerHTML = ''; }
export const menuOpen = () => layer().querySelector('.menu') != null;

function place(el, x, y) {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const nx = Math.min(Math.max(4, x), window.innerWidth - w - 4);
  const ny = Math.min(Math.max(4, y), window.innerHeight - h - 4);
  el.style.left = `${nx}px`;
  el.style.top = `${ny}px`;
}

/**
 * items: {label, icon, shortcut, danger, onClick, submenu:[...]} | {sep:true} | {header:'..'}
 * Navigabile da tastiera (frecce, Invio, Esc, freccia destra/sinistra per i sottomenu).
 */
export function showMenu(items, x, y, { restoreFocus } = {}) {
  closeMenus();
  const stack = [];

  const build = (list, px, py, parent) => {
    const el = document.createElement('div');
    el.className = 'menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = list.map((it, i) => {
      if (it.sep) return '<div class="sep"></div>';
      if (it.header) return `<div class="hd">${esc(it.header)}</div>`;
      const sc = it.submenu ? window.icon('caret-down', 'sub') : it.shortcut ? `<span class="sc">${esc(it.shortcut)}</span>` : '';
      return `<button type="button" class="it${it.danger ? ' danger' : ''}" role="menuitem" data-i="${i}">
        ${it.dot ? `<span class="dot" style="--c:${esc(it.dot)}"></span>` : it.icon ? window.icon(it.icon) : '<span style="width:16px"></span>'}
        <span>${esc(it.label)}</span>${it.tick ? `<span class="tick">${window.icon('check')}</span>` : ''}${sc}</button>`;
    }).join('');
    layer().appendChild(el);
    place(el, px, py);
    const entry = { el, list, parent, active: -1 };
    stack.push(entry);

    const activate = (i) => {
      const it = list[i];
      if (!it || it.sep || it.header) return;
      if (it.submenu) {
        while (stack.length > stack.indexOf(entry) + 1) stack.pop().el.remove();
        const r = el.querySelector(`[data-i="${i}"]`).getBoundingClientRect();
        const sub = build(it.submenu, r.right + 2, r.top - 5, entry);
        sub.active = -1;
        move(sub, 1);
        return;
      }
      if (it.keepOpen) { it.onClick?.(); return; }
      closeMenus();
      restoreFocus?.();
      it.onClick?.();
    };
    entry.activate = activate;

    el.addEventListener('mousemove', (e) => {
      const b = e.target.closest('.it');
      if (!b) return;
      const i = Number(b.dataset.i);
      if (entry.active !== i) {
        setActive(entry, i);
        if (list[i].submenu) activate(i);
        else while (stack.length > stack.indexOf(entry) + 1) stack.pop().el.remove();
      }
    });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('.it');
      if (b) activate(Number(b.dataset.i));
    });
    return entry;
  };

  const setActive = (entry, i) => {
    entry.active = i;
    entry.el.querySelectorAll('.it').forEach((b) => b.classList.toggle('active', Number(b.dataset.i) === i));
  };
  const move = (entry, dir) => {
    const n = entry.list.length;
    let i = entry.active;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      const it = entry.list[i];
      if (!it.sep && !it.header) { setActive(entry, i); return; }
    }
  };

  build(items, x, y, null);
  move(stack[0], 1);

  const onKey = (e) => {
    const top = stack[stack.length - 1];
    if (!top || !layer().querySelector('.menu')) { document.removeEventListener('keydown', onKey, true); return; }
    const k = e.key;
    if (k === 'ArrowDown') move(top, 1);
    else if (k === 'ArrowUp') move(top, -1);
    else if (k === 'Enter' || k === 'ArrowRight') {
      if (k === 'ArrowRight' && !top.list[top.active]?.submenu) return;
      top.activate(top.active);
    } else if (k === 'ArrowLeft' || k === 'Escape') {
      if (stack.length > 1) stack.pop().el.remove(); else { closeMenus(); restoreFocus?.(); }
    } else return;
    e.preventDefault(); e.stopPropagation();
  };
  document.addEventListener('keydown', onKey, true);
  const onDown = (e) => {
    if (!e.target.closest('.menu')) { closeMenus(); document.removeEventListener('mousedown', onDown, true); }
  };
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
}

let toastTimer = null;
export function toast(message, kind = 'info') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  $('#win').appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), kind === 'error' ? 4200 : 2200);
}

/**
 * Selettore etichette: digita per filtrare o creare, Invio per assegnare/rimuovere.
 * clipIds: clip a cui applicare; labels: elenco etichette; assigned(labelId)->bool
 */
export function showLabelPicker({ x, y, clipIds, getLabels, assigned, colors, onChange, restoreFocus }) {
  closeMenus();
  const el = document.createElement('div');
  el.className = 'menu';
  el.style.minWidth = '260px';
  let color = colors[getLabels().length % colors.length];
  let active = 0;
  let filter = '';

  const visible = () => getLabels().filter((l) => l.name.toLowerCase().includes(filter.toLowerCase()));
  const exact = () => getLabels().find((l) => l.name.toLowerCase() === filter.trim().toLowerCase());

  const render = () => {
    const list = visible();
    if (active >= list.length) active = Math.max(0, list.length - 1);
    el.innerHTML = `
      <div class="hd">Etichette</div>
      <div class="new"><input type="text" placeholder="Cerca o crea etichetta" value="${esc(filter)}" aria-label="Nome etichetta"></div>
      <div class="swatches" role="radiogroup" aria-label="Colore">${colors.map((c) => `<button type="button" class="swatch" role="radio" style="--c:${c}" data-c="${c}" aria-checked="${c === color}" aria-label="Colore ${c}"></button>`).join('')}</div>
      <div class="sep"></div>
      ${list.map((l, i) => `<button type="button" class="it${i === active ? ' active' : ''}" data-id="${l.id}">
        <span class="dot" style="--c:${esc(l.color)}"></span><span>${esc(l.name)}</span>
        ${assigned(l.id) ? `<span class="tick">${window.icon('check')}</span>` : ''}</button>`).join('')}
      ${filter.trim() && !exact() ? `<button type="button" class="it create ${list.length === 0 ? 'active' : ''}"><span class="dot" style="--c:${color}"></span><span>Crea “${esc(filter.trim())}”</span><span class="sc">↵</span></button>` : ''}
      ${!list.length && !filter.trim() ? '<div class="hd">Nessuna etichetta: scrivi un nome per crearla</div>' : ''}`;
    const input = el.querySelector('input');
    input.focus();
    input.setSelectionRange(filter.length, filter.length);
  };

  const toggle = async (labelId) => {
    await api('clips:labels', { ids: clipIds, labelIds: [labelId], mode: 'toggle' });
    await onChange();
  };
  const create = async () => {
    const name = filter.trim();
    if (!name) return;
    const id = await api('labels:create', { name, color });
    await api('clips:labels', { ids: clipIds, labelIds: [id], mode: 'add' });
    await onChange();
    close();
  };
  const close = () => { closeMenus(); restoreFocus?.(); };

  el.addEventListener('input', (e) => { if (e.target.tagName === 'INPUT') { filter = e.target.value; active = 0; render(); } });
  el.addEventListener('click', (e) => {
    const sw = e.target.closest('.swatch');
    if (sw) { color = sw.dataset.c; render(); return; }
    const it = e.target.closest('.it');
    if (!it) return;
    if (it.classList.contains('create')) create();
    else toggle(Number(it.dataset.id)).then(() => { render(); });
  });
  el.addEventListener('keydown', (e) => {
    const list = visible();
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, list.length - 1); render(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (filter.trim() && !exact() && list.length === 0) create();
      else if (list[active]) toggle(list[active].id).then(() => render());
      else if (filter.trim() && !exact()) create();
    } else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else return;
    e.preventDefault();
  });
  layer().appendChild(el);
  render();
  place(el, x, y);
  const onDown = (e) => { if (!e.target.closest('.menu')) { close(); document.removeEventListener('mousedown', onDown, true); } };
  setTimeout(() => document.addEventListener('mousedown', onDown, true), 0);
}
