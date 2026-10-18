'use strict';
// Accesso diretto alla clipboard di Windows (koffi). Sostituisce l'API Electron, che dalla v44 è asincrona
// e non espone formati arbitrari (CF_HDROP, HTML Format, RTF, ...).
const koffi = require('koffi');
const { nativeImage } = require('electron');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');
const shell32 = koffi.load('shell32.dll');

const OpenClipboard = user32.func('bool OpenClipboard(void *)');
const CloseClipboard = user32.func('bool CloseClipboard()');
const EmptyClipboard = user32.func('bool EmptyClipboard()');
const SetClipboardData = user32.func('void * SetClipboardData(uint32_t, void *)');
const GetClipboardData = user32.func('void * GetClipboardData(uint32_t)');
const EnumClipboardFormats = user32.func('uint32_t EnumClipboardFormats(uint32_t)');
const IsClipboardFormatAvailable = user32.func('bool IsClipboardFormatAvailable(uint32_t)');
const RegisterClipboardFormatW = user32.func('uint32_t RegisterClipboardFormatW(str16)');
const GlobalAlloc = kernel32.func('void * GlobalAlloc(uint32_t, uintptr_t)');
const GlobalLock = kernel32.func('void * GlobalLock(void *)');
const GlobalUnlock = kernel32.func('bool GlobalUnlock(void *)');
const GlobalSize = kernel32.func('uintptr_t GlobalSize(void *)');
const GlobalFree = kernel32.func('void * GlobalFree(void *)');
const DragQueryFileW = shell32.func('uint32_t DragQueryFileW(void *, uint32_t, _Out_ uint16_t *, uint32_t)');

const CF = { TEXT: 1, DIB: 8, UNICODETEXT: 13, HDROP: 15, DIBV5: 17 };
const GMEM_MOVEABLE = 0x0002;
const ids = {};
const fmt = (name) => (ids[name] ??= RegisterClipboardFormatW(name));

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withClipboard(fn, tries = 10) {
  for (let i = 0; i < tries; i++) {
    if (OpenClipboard(null)) {
      try { return fn(); } finally { CloseClipboard(); }
    }
    sleepSync(15);
  }
  return undefined;
}

function readHandle(h) {
  if (!h) return null;
  const size = Number(GlobalSize(h));
  const p = GlobalLock(h);
  if (!p) return null;
  try {
    // koffi.view (ArrayBuffer esterni) non è ammesso in Electron: decode su array tipizzato (memcpy).
    const a = koffi.decode(p, koffi.array('uint8_t', size, 'Typed'));
    return Buffer.from(a.buffer, a.byteOffset, a.length);
  } finally { GlobalUnlock(h); }
}

function utf16z(buf) {
  if (!buf) return '';
  let end = buf.length - (buf.length % 2);
  for (let i = 0; i < end; i += 2) if (buf[i] === 0 && buf[i + 1] === 0) { end = i; break; }
  return buf.toString('utf16le', 0, end);
}

function cstr(buf) {
  if (!buf) return '';
  const z = buf.indexOf(0);
  return buf.toString('utf8', 0, z < 0 ? buf.length : z);
}

function parseHtmlFormat(buf) {
  const raw = cstr(buf);
  if (!raw) return { fragment: '', url: null };
  const num = (k) => { const m = new RegExp(`${k}:(\\d+)`).exec(raw); return m ? Number(m[1]) : -1; };
  const sf = num('StartFragment');
  const ef = num('EndFragment');
  const url = (/SourceURL:(\S+)/.exec(raw) || [])[1] || null;
  const bytes = Buffer.from(raw, 'utf8');
  const fragment = sf >= 0 && ef > sf ? bytes.toString('utf8', sf, ef) : raw.replace(/^[\s\S]*?<html/i, '<html');
  return { fragment, url };
}

/** DIB (CF_DIB/CF_DIBV5) 24/32 bit -> PNG. Decodifica manuale: createFromBuffer non legge in modo affidabile i BMP. */
function dibToPng(dib) {
  if (!dib || dib.length < 40) return null;
  const hdr = dib.readUInt32LE(0);
  const w = dib.readInt32LE(4);
  const rawH = dib.readInt32LE(8);
  const bpp = dib.readUInt16LE(14);
  const comp = dib.readUInt32LE(16);
  if (!(bpp === 24 || bpp === 32) || !(comp === 0 || comp === 3) || w <= 0 || rawH === 0) return null;
  const h = Math.abs(rawH);
  const topDown = rawH < 0;
  const masks = comp === 3 && hdr === 40 ? 12 : 0;
  const off = hdr + masks + dib.readUInt32LE(32) * 4;
  const srcStride = Math.floor((w * bpp + 31) / 32) * 4;
  if (dib.length < off + srcStride * h - (srcStride - Math.ceil((w * bpp) / 8))) return null;
  const bm = Buffer.alloc(w * h * 4);
  let anyAlpha = false;
  for (let y = 0; y < h; y++) {
    const srow = off + (topDown ? y : h - 1 - y) * srcStride;
    for (let x = 0; x < w; x++) {
      const si = srow + x * (bpp / 8);
      const di = (y * w + x) * 4;
      bm[di] = dib[si]; bm[di + 1] = dib[si + 1]; bm[di + 2] = dib[si + 2];
      if (bpp === 32) { bm[di + 3] = dib[si + 3]; if (dib[si + 3]) anyAlpha = true; } else bm[di + 3] = 255;
    }
  }
  if (bpp === 32 && !anyAlpha) for (let i = 3; i < bm.length; i += 4) bm[i] = 255;
  const img = nativeImage.createFromBitmap(bm, { width: w, height: h });
  return img.isEmpty() ? null : img.toPNG();
}

function pngToDib(png) {
  const img = nativeImage.createFromBuffer(png);
  if (img.isEmpty()) return null;
  const { width, height } = img.getSize();
  const bgra = img.toBitmap();
  const stride = width * 4;
  const out = Buffer.alloc(40 + stride * height);
  out.writeUInt32LE(40, 0);
  out.writeInt32LE(width, 4);
  out.writeInt32LE(height, 8);
  out.writeUInt16LE(1, 12);
  out.writeUInt16LE(32, 14);
  out.writeUInt32LE(stride * height, 20);
  for (let y = 0; y < height; y++) bgra.copy(out, 40 + (height - 1 - y) * stride, y * stride, (y + 1) * stride);
  return out;
}

function buildHtmlFormat(fragment, sourceUrl) {
  const pre = '<html><body>\r\n<!--StartFragment-->';
  const post = '<!--EndFragment-->\r\n</body></html>';
  const mk = (sh, eh, sf, ef) => {
    const p = (n) => String(n).padStart(10, '0');
    return `Version:0.9\r\nStartHTML:${p(sh)}\r\nEndHTML:${p(eh)}\r\nStartFragment:${p(sf)}\r\nEndFragment:${p(ef)}\r\n`
      + (sourceUrl ? `SourceURL:${sourceUrl}\r\n` : '');
  };
  const head = mk(0, 0, 0, 0);
  const hl = Buffer.byteLength(head);
  const sh = hl;
  const sf = sh + Buffer.byteLength(pre);
  const ef = sf + Buffer.byteLength(fragment);
  const eh = ef + Buffer.byteLength(post);
  return Buffer.from(mk(sh, eh, sf, ef) + pre + fragment + post + '\0', 'utf8');
}

/** Legge lo stato corrente. Restituisce {text, html, htmlUrl, rtf, png, files, formats} o null se bloccata. */
function read() {
  const res = withClipboard(() => {
    const out = { text: '', html: '', htmlUrl: null, rtf: '', png: null, dib: null, files: [], formats: [] };
    for (let f = EnumClipboardFormats(0); f; f = EnumClipboardFormats(f)) out.formats.push(f);
    const has = (id) => out.formats.includes(id);
    if (has(CF.UNICODETEXT)) out.text = utf16z(readHandle(GetClipboardData(CF.UNICODETEXT)));
    else if (has(CF.TEXT)) out.text = cstr(readHandle(GetClipboardData(CF.TEXT)));
    if (has(fmt('HTML Format'))) {
      const h = parseHtmlFormat(readHandle(GetClipboardData(fmt('HTML Format'))));
      out.html = h.fragment; out.htmlUrl = h.url;
    }
    if (has(fmt('Rich Text Format'))) out.rtf = cstr(readHandle(GetClipboardData(fmt('Rich Text Format'))));
    if (has(fmt('PNG'))) out.png = readHandle(GetClipboardData(fmt('PNG')));
    else if (has(CF.DIBV5)) out.dib = readHandle(GetClipboardData(CF.DIBV5));
    else if (has(CF.DIB)) out.dib = readHandle(GetClipboardData(CF.DIB));
    if (has(CF.HDROP)) {
      const h = GetClipboardData(CF.HDROP);
      const count = h ? DragQueryFileW(h, 0xffffffff, null, 0) : 0;
      for (let i = 0; i < count; i++) {
        const len = DragQueryFileW(h, i, null, 0);
        const buf = new Uint16Array(len + 1);
        DragQueryFileW(h, i, buf, len + 1);
        out.files.push(Buffer.from(buf.buffer, 0, len * 2).toString('utf16le'));
      }
    }
    return out;
  });
  if (!res) return null;
  if (!res.png && res.dib) res.png = dibToPng(res.dib);
  delete res.dib;
  return res;
}

/** Formato registrato presente? (es. ExcludeClipboardContentFromMonitorProcessing) */
function hasRegistered(name) { return !!IsClipboardFormatAvailable(fmt(name)); }

function alloc(buf) {
  const mem = GlobalAlloc(GMEM_MOVEABLE, Math.max(buf.length, 1));
  if (!mem) return null;
  const p = GlobalLock(mem);
  if (!p) { GlobalFree(mem); return null; }
  if (buf.length) koffi.encode(p, koffi.array('uint8_t', buf.length, 'Typed'), new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  GlobalUnlock(mem);
  return mem;
}

function filesBuffer(paths) {
  const list = Buffer.from(paths.join('\0') + '\0\0', 'utf16le');
  const head = Buffer.alloc(20);
  head.writeUInt32LE(20, 0);
  head.writeInt32LE(1, 16); // fWide
  return Buffer.concat([head, list]);
}

/**
 * Scrive tutti i formati in un'unica operazione.
 * c: {text, html, htmlUrl, rtf, png, files}
 */
function write(c) {
  const items = [];
  if (c.files?.length) items.push([CF.HDROP, filesBuffer(c.files)]);
  if (c.text != null && !c.files?.length) items.push([CF.UNICODETEXT, Buffer.from((c.text || '') + '\0', 'utf16le')]);
  if (c.html) items.push([fmt('HTML Format'), buildHtmlFormat(c.html, c.htmlUrl)]);
  if (c.rtf) items.push([fmt('Rich Text Format'), Buffer.from(c.rtf + '\0', 'utf8')]);
  if (c.png) {
    items.push([fmt('PNG'), c.png]);
    const dib = pngToDib(c.png);
    if (dib) items.push([CF.DIB, dib]);
  }
  if (!items.length) return false;
  const ok = withClipboard(() => {
    EmptyClipboard();
    let any = false;
    for (const [id, buf] of items) {
      const mem = alloc(buf);
      if (mem && SetClipboardData(id, mem)) any = true;
      else if (mem) GlobalFree(mem);
    }
    return any;
  });
  return !!ok;
}

module.exports = { read, write, hasRegistered, dibToPng, pngToDib, buildHtmlFormat, parseHtmlFormat, utf16z };
