'use strict';
const { clipboard, nativeImage } = require('electron');
const win32 = require('./win32');
const { apply } = require('./transforms');
const { separatorValue } = require('./settings');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mette una clip sulla clipboard di sistema. Restituisce il testo scritto (se testo). */
function writeClipToClipboard(store, id, { plain = false, transform = null } = {}) {
  const formats = store.getFormats(id);
  const by = Object.fromEntries(formats.map((f) => [f.format, f.data]));

  if (by.files && !plain) {
    win32.writeFiles(JSON.parse(by.files.toString('utf8')));
    return null;
  }
  if (by.png && !by.text) {
    clipboard.writeImage(nativeImage.createFromBuffer(by.png));
    return null;
  }
  let text = by.text ? by.text.toString('utf8') : '';
  if (by.files && plain) text = JSON.parse(by.files.toString('utf8')).join('\n');
  if (transform) {
    text = apply(transform, text);
    clipboard.writeText(text);
    return text;
  }
  if (plain) {
    clipboard.writeText(text);
    return text;
  }
  const data = { text };
  if (by.html) data.html = by.html.toString('utf8');
  if (by.rtf) data.rtf = by.rtf.toString('utf8');
  if (by.png) data.image = nativeImage.createFromBuffer(by.png);
  clipboard.write(data);
  return text;
}

function joinTexts(store, ids, settings) {
  const sep = separatorValue(settings.get('multiSeparator'));
  const ordered = settings.get('multiReverse') ? [...ids].reverse() : ids;
  return ordered.map((id) => store.getText(id) ?? '').join(sep);
}

/**
 * Incolla nella finestra che aveva il focus prima del popup.
 * ctx: {store, settings, watcher, target(hwnd)}
 */
async function pasteClips(ctx, ids, opts = {}) {
  const { store, settings, watcher, target } = ctx;
  if (!ids.length) return false;

  if (target) win32.restoreForeground(target);

  if (ids.length > 1) {
    let text = joinTexts(store, ids, settings);
    if (opts.transform) text = apply(opts.transform, text);
    clipboard.writeText(text);
  } else {
    writeClipToClipboard(store, ids[0], opts);
  }
  watcher.markSelfWrite();

  const delay = settings.get('pasteDelayMs');
  const deadline = Date.now() + 400;
  while (target && win32.foregroundWindow() !== target && Date.now() < deadline) await sleep(15);
  await sleep(delay);

  const exe = win32.exeName(win32.processExeOfWindow(win32.foregroundWindow()));
  const style = (settings.get('pasteStyles') || {})[exe] || 'ctrl+v';
  win32.sendPasteKeys(style);

  for (const id of ids) store.markUsed(id, { reorder: settings.get('updateOrderOnPaste') && !opts.keepOrder });
  return true;
}

module.exports = { pasteClips, writeClipToClipboard };
