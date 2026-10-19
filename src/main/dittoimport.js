'use strict';
// Import del database di Ditto (Ditto.db, SQLite). Schema: Main (clip e gruppi) + Data (un formato per riga).
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('./db');
const { utf16z, cstr, parseHtmlFormat } = require('./clipformats');

const PALETTE = ['#ef6a5b', '#f0913a', '#e3c23b', '#5fbf6a', '#4aa8e8', '#7b86f0', '#e56fb0', '#8a9aa0'];

/** CF_HDROP grezzo (DROPFILES + elenco) -> percorsi. */
function parseDropFiles(buf) {
  if (!buf || buf.length < 20) return [];
  const off = buf.readUInt32LE(0);
  const wide = buf.readInt32LE(16) !== 0;
  const list = buf.subarray(off);
  const text = wide ? list.toString('utf16le') : list.toString('latin1');
  return text.split('\0').filter(Boolean);
}

const norm = (t, n) => t.replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * image (opzionale, richiede Electron): {fromDib(buf)->png|null, info(png)->{width,height}, thumb(png)->Buffer}.
 * Senza `image` le clip che contengono solo un'immagine vengono contate in `skipped`.
 * Restituisce {imported, skipped, duplicates, labels}.
 */
function importDitto(store, file, { image = null, descChars = 500 } = {}) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-ditto-')), 'Ditto.db');
  fs.copyFileSync(file, tmp); // copia: Ditto può avere il file aperto
  let d;
  try {
    d = new DatabaseSync(tmp, { readOnly: true });
    const has = (t) => d.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (!has('Main') || !has('Data')) throw new Error('Non sembra un database di Ditto');

    const existing = new Map(store.listLabels().map((l) => [l.name.toLowerCase(), l.id]));
    const groupLabel = new Map();
    let createdLabels = 0;
    for (const g of d.prepare('SELECT lID, mText FROM Main WHERE bIsGroup = 1').all()) {
      const name = String(g.mText || '').trim();
      if (!name) continue;
      let id = existing.get(name.toLowerCase());
      if (!id) {
        id = store.createLabel(name, PALETTE[(existing.size + createdLabels) % PALETTE.length]);
        existing.set(name.toLowerCase(), id);
        createdLabels++;
      }
      groupLabel.set(g.lID, id);
    }

    const fmtStmt = d.prepare('SELECT strClipBoardFormat AS f, ooData AS b FROM Data WHERE lParentID = ?');
    let imported = 0;
    let skipped = 0;
    let duplicates = 0;
    // clipOrder crescente: così l'ordine di inserimento conserva l'ordine di Ditto (le più recenti per ultime)
    for (const m of d.prepare('SELECT * FROM Main WHERE COALESCE(bIsGroup, 0) = 0 ORDER BY clipOrder ASC, lID ASC').all()) {
      const by = {};
      for (const r of fmtStmt.all(m.lID)) by[String(r.f).toUpperCase()] = r.b ? Buffer.from(r.b) : null;

      const formats = [];
      let kind;
      let preview;
      let searchText = '';
      let size = 0;
      let hashParts;
      const files = parseDropFiles(by.CF_HDROP);
      const text = by.CF_UNICODETEXT ? utf16z(by.CF_UNICODETEXT) : by.CF_TEXT ? cstr(by.CF_TEXT) : '';
      const html = by['HTML FORMAT'] ? parseHtmlFormat(by['HTML FORMAT']) : null;
      const rtf = by['RICH TEXT FORMAT'] ? cstr(by['RICH TEXT FORMAT']) : '';
      let png = by.PNG || null;
      if (!png && image) png = image.fromDib(by.CF_DIBV5 || by.CF_DIB || null);

      if (files.length) {
        kind = 'files';
        const data = Buffer.from(JSON.stringify(files), 'utf8');
        formats.push({ format: 'files', data });
        preview = files.map((f) => path.basename(f)).join(', ');
        searchText = files.join('\n').toLowerCase();
        size = data.length;
        hashParts = ['files', data];
      } else if (text) {
        kind = 'text';
        const data = Buffer.from(text, 'utf8');
        formats.push({ format: 'text', data });
        if (html?.fragment) formats.push({ format: 'html', data: Buffer.from(html.fragment, 'utf8') });
        if (rtf) formats.push({ format: 'rtf', data: Buffer.from(rtf, 'utf8') });
        preview = norm(text, descChars);
        searchText = text.toLowerCase().slice(0, 200000);
        size = data.length;
        hashParts = ['text', data];
      } else if (png && image) {
        kind = 'image';
        const { width, height } = image.info(png);
        formats.push({ format: 'png', data: png }, { format: 'thumb', data: image.thumb(png) });
        preview = `Immagine ${width}×${height}`;
        size = png.length;
        hashParts = ['png', png];
      } else {
        skipped++;
        continue;
      }

      const hash = Store.hashOf(hashParts);
      if (store.findByHash(hash)) { duplicates++; continue; }
      const { id } = store.addClip({
        kind, hash, preview, searchText, size, formats,
        source: { exe: null, title: null, url: html?.url || null },
      });
      const last = Number(m.lastPasteDate) > 0 ? Number(m.lastPasteDate) * 1000 : null;
      store.db.prepare('UPDATE clips SET created_at=?, last_used_at=?, use_count=?, never_delete=?, quick_name=? WHERE id=?')
        .run(Number(m.lDate) > 0 ? Number(m.lDate) * 1000 : Date.now(), last, last ? 1 : 0, m.lDontAutoDelete ? 1 : 0, m.QuickPasteText || null, id);
      if (Number(m.stickyClipOrder) > 0) store.setPinned(id, true);
      const label = groupLabel.get(m.lParentID);
      if (label) store.assignLabel([id], [label], 'add');
      imported++;
    }
    return { imported, skipped, duplicates, labels: createdLabels };
  } finally {
    try { d?.close(); } catch { /* già chiuso */ }
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

module.exports = { importDitto, parseDropFiles };
