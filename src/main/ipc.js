'use strict';
const { ipcMain, dialog, app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./db');
const { pasteClips, writeClipToClipboard } = require('./paste');
const { TRANSFORM_LABELS } = require('./transforms');
const { exportClips, importClips, exportText } = require('./exporter');

const LABEL_COLORS = ['#ef6a5b', '#f0913a', '#e3c23b', '#5fbf6a', '#4aa8e8', '#7b86f0', '#e56fb0', '#8a9aa0'];
const TEXT_LIMIT = 300000;

function register(app_) {
  const { store, settings, watcher, windows } = app_;
  const handle = (channel, fn) => ipcMain.handle(channel, async (_e, payload) => {
    try { return await fn(payload); } catch (err) {
      console.error(channel, err);
      return { __error: String(err.message || err) };
    }
  });
  const changed = () => windows.broadcast('list:changed');
  const toast = (message, kind = 'info') => windows.broadcast('toast', { message, kind });

  handle('clips:list', (o = {}) => store.list({
    mode: settings.get('searchMode'), scope: settings.get('searchScope'), ...o,
  }));

  handle('clips:get', (id) => {
    const clip = store.getClip(id);
    if (!clip) return null;
    const out = { clip, text: null, html: null, files: [], hasImage: false, truncated: false };
    const text = store.getText(id);
    if (text != null) {
      out.truncated = text.length > TEXT_LIMIT;
      out.text = out.truncated ? text.slice(0, TEXT_LIMIT) : text;
    }
    const html = store.getFormat(id, 'html');
    if (html) out.html = html.toString('utf8').slice(0, 400000);
    const files = store.getFormat(id, 'files');
    if (files) out.files = JSON.parse(files.toString('utf8'));
    out.hasImage = !!clip.formats.find((f) => f.format === 'png');
    return out;
  });

  handle('clips:paste', async ({ ids, plain, transform, keepOrder }) => {
    windows.hidePopup();
    await pasteClips({ store, settings, watcher, target: windows.target }, ids, { plain, transform, keepOrder });
    changed();
    return true;
  });

  handle('clips:copy', ({ id, plain }) => {
    writeClipToClipboard(store, id, { plain });
    watcher.markSelfWrite();
    store.markUsed(id, { reorder: settings.get('updateOrderOnPaste') });
    changed();
    return true;
  });

  handle('clips:delete', (ids) => { const n = store.delete(ids); changed(); return n; });
  handle('clips:pin', ({ id, pinned }) => { store.setPinned(id, pinned); changed(); return true; });
  handle('clips:move', ({ id, where }) => { store.move(id, where); changed(); return true; });
  handle('clips:set-meta', ({ id, meta }) => { store.setMeta(id, meta); app_.registerHotkeys(); changed(); return true; });
  handle('clips:labels', ({ ids, labelIds, mode }) => { store.assignLabel(ids, labelIds, mode); changed(); return true; });
  handle('clips:update-text', ({ id, text }) => {
    store.updateText(id, text, { previewChars: settings.get('descChars') });
    changed();
    return true;
  });
  handle('clips:new', (text = '') => {
    const buf = Buffer.from(text, 'utf8');
    const { id } = store.addClip({
      kind: 'text', hash: Store.hashOf(['text', buf, String(Date.now())]), preview: text.replace(/\s+/g, ' ').trim(),
      searchText: text.toLowerCase(), size: buf.length, source: { exe: 'crispboard' },
      formats: [{ format: 'text', data: buf }],
    });
    store.db.prepare('UPDATE clips SET edited=1 WHERE id=?').run(id);
    changed();
    return id;
  });

  handle('clips:export-text', async (ids) => {
    const r = await dialog.showSaveDialog({ defaultPath: 'clip.txt', filters: [{ name: 'Testo', extensions: ['txt'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, exportText(store, ids), 'utf8');
    toast('Esportato in ' + path.basename(r.filePath));
    return true;
  });
  handle('clips:export-image', async (id) => {
    const png = store.getFormat(id, 'png');
    if (!png) return false;
    const r = await dialog.showSaveDialog({ defaultPath: 'immagine.png', filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, png);
    toast('Immagine salvata');
    return true;
  });

  handle('labels:list', () => store.listLabels());
  handle('labels:create', ({ name, color }) => {
    const id = store.createLabel(name, color || LABEL_COLORS[store.listLabels().length % LABEL_COLORS.length]);
    changed();
    return id;
  });
  handle('labels:update', ({ id, name, color }) => { store.updateLabel(id, { name, color }); changed(); return true; });
  handle('labels:delete', (id) => { store.deleteLabel(id); changed(); return true; });

  handle('settings:get', () => settings.all());
  handle('settings:meta', () => ({
    transforms: TRANSFORM_LABELS, labelColors: LABEL_COLORS, version: app.getVersion(),
    dbPath: store.file, platform: process.platform,
  }));
  handle('settings:set', (patch) => {
    const keys = settings.set(patch);
    if (keys.length) app_.onSettingsChanged(keys);
    return settings.all();
  });

  handle('window:hide', () => { windows.hidePopup(); return true; });
  handle('window:settings', (tab) => { windows.openSettings(tab); return true; });
  handle('window:suppress-blur', (on) => { windows.suppressBlur = !!on; return true; });
  handle('app:quit', () => { app_.quit(); return true; });
  handle('clipboard:toggle', () => {
    settings.set({ connected: !settings.get('connected') });
    app_.onSettingsChanged(['connected']);
    return settings.get('connected');
  });

  handle('data:export', async (ids) => {
    const r = await dialog.showSaveDialog({
      defaultPath: 'crispboard-export.json', filters: [{ name: 'Crispboard', extensions: ['json'] }] });
    if (r.canceled) return false;
    fs.writeFileSync(r.filePath, exportClips(store, ids || null), 'utf8');
    toast('Esportazione completata');
    return true;
  });
  handle('data:import', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Crispboard', extensions: ['json'] }] });
    if (r.canceled) return null;
    const res = importClips(store, fs.readFileSync(r.filePaths[0], 'utf8'));
    changed();
    toast(`Importate ${res.imported} clip (${res.skipped} già presenti)`);
    return res;
  });
  handle('data:backup', async () => {
    const r = await dialog.showSaveDialog({ defaultPath: 'crispboard-backup.db', filters: [{ name: 'Database', extensions: ['db'] }] });
    if (r.canceled) return false;
    store.backupTo(r.filePath);
    toast('Backup creato');
    return true;
  });
  handle('data:restore', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Database', extensions: ['db'] }] });
    if (r.canceled) return false;
    const c = await dialog.showMessageBox({
      type: 'warning', buttons: ['Ripristina', 'Annulla'], defaultId: 1, cancelId: 1,
      message: 'Ripristinare il database?', detail: 'La cronologia attuale verrà sostituita. Crispboard si riavvierà.' });
    if (c.response !== 0) return false;
    store.close();
    for (const ext of ['-wal', '-shm']) fs.rmSync(store.file + ext, { force: true });
    fs.copyFileSync(r.filePaths[0], store.file);
    app.relaunch();
    app.exit(0);
    return true;
  });
  handle('data:compact', () => { store.compact(); toast('Database compattato'); return store.stats(); });
  handle('data:clear', ({ keepPinned = true } = {}) => { const n = store.deleteAll({ keepPinned }); changed(); return n; });
  handle('data:delete-unused', () => { const n = store.deleteUnused(); changed(); toast(`Eliminate ${n} clip mai usate`); return n; });
  handle('data:stats', () => store.stats());

  return { changed, toast };
}

module.exports = { register, LABEL_COLORS };
