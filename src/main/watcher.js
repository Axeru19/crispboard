'use strict';
const { clipboard } = require('electron');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const win32 = require('./win32');
const { Store } = require('./db');

const POLL_MS = 120;
const SETTLE_MS = 60;

function normalizePreview(text, chars) {
  return text.replace(/\s+/g, ' ').trim().slice(0, chars);
}

function sourceUrlFromHtmlFormat() {
  try {
    const raw = clipboard.readBuffer('HTML Format').toString('utf8');
    const m = /SourceURL:(\S+)/i.exec(raw);
    return m ? m[1] : null;
  } catch { return null; }
}

class Watcher extends EventEmitter {
  constructor(store, settings) {
    super();
    this.store = store;
    this.settings = settings;
    this.timer = null;
    this.lastSeq = win32.sequenceNumber();
    this.ignoreUpTo = 0;
    this.lastHash = null;
    this.lastAt = 0;
    this.busy = false;
  }

  start() {
    if (this.timer) return;
    this.lastSeq = win32.sequenceNumber();
    this.timer = setInterval(() => this.tick(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Da chiamare subito dopo aver scritto noi stessi nella clipboard. */
  markSelfWrite() {
    this.ignoreUpTo = win32.sequenceNumber();
    this.lastSeq = this.ignoreUpTo;
  }

  tick() {
    if (this.busy || !this.settings.get('connected')) return;
    const seq = win32.sequenceNumber();
    if (seq === this.lastSeq) return;
    this.lastSeq = seq;
    if (seq <= this.ignoreUpTo) return;
    this.busy = true;
    setTimeout(() => {
      try { this.capture(); } catch (e) { this.emit('error', e); } finally { this.busy = false; }
    }, SETTLE_MS);
  }

  allowedBySource(src) {
    const exe = src.exe;
    if (!exe) return true;
    const inc = this.settings.get('includeApps').map((s) => s.toLowerCase());
    const exc = this.settings.get('excludeApps').map((s) => s.toLowerCase());
    if (inc.length && !inc.includes(exe)) return false;
    return !exc.includes(exe);
  }

  /** Legge la clipboard corrente e la salva. Restituisce l'id o null. */
  capture() {
    const s = this.settings;
    if (s.get('respectPrivacyFormats') && win32.hasRegisteredFormat('ExcludeClipboardContentFromMonitorProcessing')) return null;
    const source = win32.clipboardSource();
    if (!this.allowedBySource(source)) return null;

    const text = clipboard.readText();
    const fmts = clipboard.availableFormats();
    const hasImage = fmts.some((f) => f.startsWith('image/'));
    const files = win32.hasFiles() ? win32.readFiles() : [];
    const html = fmts.includes('text/html') ? clipboard.readHTML() : '';
    const rtf = fmts.includes('text/rtf') ? clipboard.readRTF() : '';

    const formats = [];
    let kind;
    let preview;
    let searchText = '';
    let size = 0;
    let hashParts;
    const descChars = s.get('descChars');

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
      if (html) formats.push({ format: 'html', data: Buffer.from(html, 'utf8') });
      if (rtf) formats.push({ format: 'rtf', data: Buffer.from(rtf, 'utf8') });
      preview = normalizePreview(text, descChars);
      searchText = text.toLowerCase().slice(0, 200000);
      size = data.length;
      hashParts = ['text', data];
    } else if (hasImage) {
      const img = clipboard.readImage();
      if (img.isEmpty()) return null;
      kind = 'image';
      const png = img.toPNG();
      const { width, height } = img.getSize();
      formats.push({ format: 'png', data: png });
      formats.push({ format: 'thumb', data: img.resize({ height: Math.min(96, height) }).toPNG() });
      preview = `Immagine ${width}×${height}`;
      size = png.length;
      hashParts = ['png', png];
    } else {
      return null;
    }

    const max = s.get('maxClipBytes');
    if (max > 0 && size > max) return null;

    const hash = Store.hashOf(hashParts);
    const now = Date.now();
    if (hash === this.lastHash && now - this.lastAt < s.get('duplicateWindowMs')) { this.lastAt = now; return null; }
    this.lastHash = hash;
    this.lastAt = now;

    const existing = this.store.findByHash(hash);
    if (existing && !s.get('allowDuplicates')) {
      this.store.bump(existing.id);
      this.emit('changed', { id: existing.id, duplicate: true });
      return existing.id;
    }

    const url = html ? sourceUrlFromHtmlFormat() : null;
    const { id } = this.store.addClip({
      kind, hash, preview, searchText, size, formats,
      source: { exe: source.exe, title: source.title, url },
    });
    this.store.applyRetention({ maxEntries: s.get('maxEntries'), expireDays: s.get('expireDays') });
    this.emit('changed', { id, duplicate: false });
    return id;
  }
}

module.exports = { Watcher };
