export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Evidenzia le occorrenze (modalità "contiene") senza interpretare HTML. */
export function highlight(text, query, mode) {
  const safe = esc(text);
  if (!query || mode !== 'contains') return safe;
  const q = esc(query.trim());
  if (!q) return safe;
  const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return safe.replace(rx, (m) => `<mark>${m}</mark>`);
}

export function relTime(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'ora';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d === 1) return 'ieri';
  if (d < 7) return `${d} giorni`;
  return new Date(ts).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function looksLikeCode(t) {
  if (!t || t.length < 12) return false;
  const sym = (t.match(/[{}();=<>[\]]/g) || []).length;
  return sym / t.length > 0.06 || /^\s{2,}\S/m.test(t) && sym > 3;
}

export const isUrl = (t) => /^https?:\/\/\S+$/i.test((t || '').trim());

export function appLabel(exe) {
  if (!exe) return '';
  return exe.replace(/\.exe$/i, '');
}

export const api = (channel, payload) => window.crisp.invoke(channel, payload).then((r) => {
  if (r && typeof r === 'object' && r.__error) throw new Error(r.__error);
  return r;
});
