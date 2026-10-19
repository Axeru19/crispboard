'use strict';
const { app, globalShortcut, Tray, Menu, nativeImage, nativeTheme, protocol, shell, dialog } = require('electron');
const path = require('node:path');

protocol.registerSchemesAsPrivileged([
  { scheme: 'crisp', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.CRISPBOARD_DATA_DIR || path.join(app.getPath('appData'), 'Crispboard');
app.setPath('userData', path.join(DATA_DIR, 'electron'));

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const { Store } = require('./db');
const { Settings } = require('./settings');
const { Watcher } = require('./watcher');
const { Windows } = require('./windows');
const { pasteClips } = require('./paste');
const { Sync } = require('./sync');
const win32 = require('./win32');
const ipc = require('./ipc');

const state = {};

function trayMenu() {
  const { settings, windows } = state;
  const connected = settings.get('connected');
  return Menu.buildFromTemplate([
    { label: 'Apri Crispboard', click: () => windows.showPopup() },
    { type: 'separator' },
    { label: connected ? 'Sospendi cattura' : 'Riprendi cattura', click: () => state.api.toggleConnection() },
    { label: 'Impostazioni', click: () => windows.openSettings() },
    { type: 'separator' },
    { label: 'Esci', click: () => state.quit() },
  ]);
}

function refreshTray() {
  const { settings } = state;
  if (!settings.get('showTray')) {
    state.tray?.destroy();
    state.tray = null;
    return;
  }
  if (!state.tray) {
    state.tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png')));
    state.tray.on('click', () => state.windows.togglePopup());
  }
  state.tray.setToolTip(settings.get('connected') ? 'Crispboard' : 'Crispboard (cattura sospesa)');
  state.tray.setContextMenu(trayMenu());
}

async function pasteNow(id, opts = {}) {
  const { store, settings, watcher, windows } = state;
  await pasteClips({ store, settings, watcher, target: win32.foregroundWindow() }, [id], opts);
  windows.broadcast('list:changed');
}

/** Copia (o taglia) nell'app attiva e assegna la clip risultante a uno slot di buffer. */
async function copyIntoBuffer(slot, cut) {
  const { settings, watcher, windows } = state;
  const before = win32.sequenceNumber();
  win32.sendCopyKeys(cut);
  const deadline = Date.now() + 800;
  while (win32.sequenceNumber() === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  if (win32.sequenceNumber() === before) { console.warn('buffer: la clipboard non è cambiata'); return; }
  await new Promise((r) => setTimeout(r, 80));
  watcher.lastSeq = win32.sequenceNumber();
  const id = watcher.capture();
  if (id) {
    settings.set({ bufferClips: { ...(settings.get('bufferClips') || {}), [slot]: id } });
    windows.broadcast('list:changed');
    windows.broadcast('toast', { message: `Salvata nel buffer ${slot}` });
  }
}

function registerHotkeys() {
  const { settings, store, windows } = state;
  globalShortcut.unregisterAll();
  const failed = [];
  const reg = (acc, fn) => {
    try { if (!globalShortcut.register(acc, fn)) failed.push(acc); } catch { failed.push(acc); }
  };
  reg(settings.get('hotkey'), () => windows.togglePopup());

  if (settings.get('globalLastTen')) {
    const mod = settings.get('globalLastTenModifier');
    for (let n = 1; n <= 10; n++) {
      const key = n % 10;
      reg(`${mod}+${key}`, () => {
        const id = store.recentIds(10)[n - 1];
        if (id) pasteNow(id);
      });
    }
  }
  for (let n = 1; n <= 3; n++) {
    if (settings.get(`cbCopy${n}`)) reg(settings.get(`cbCopy${n}`), () => copyIntoBuffer(n, false));
    if (settings.get(`cbCut${n}`)) reg(settings.get(`cbCut${n}`), () => copyIntoBuffer(n, true));
    if (settings.get(`cbPaste${n}`)) {
      reg(settings.get(`cbPaste${n}`), () => {
        const id = (settings.get('bufferClips') || {})[n];
        if (id && store.getClip(id)) pasteNow(id, { keepOrder: true });
        else windows.broadcast('toast', { message: `Il buffer ${n} è vuoto`, kind: 'error' });
      });
    }
  }
  for (const r of store.db.prepare('SELECT id, hotkey FROM clips WHERE hotkey IS NOT NULL AND hotkey != \'\'').all()) {
    reg(r.hotkey, () => pasteNow(r.id));
  }
  if (failed.length) {
    console.warn('scorciatoie non registrate:', failed.join(', '));
    windows.broadcast('toast', { message: `Scorciatoia già in uso: ${failed.join(', ')}`, kind: 'error' });
  }
  return failed;
}

function onSettingsChanged(keys) {
  const { settings, windows, watcher } = state;
  if (keys.includes('theme')) nativeTheme.themeSource = settings.get('theme');
  if (keys.some((k) => ['hotkey', 'globalLastTen', 'globalLastTenModifier'].includes(k) || /^cb(Copy|Cut|Paste)\d$/.test(k))) registerHotkeys();
  if (keys.some((k) => ['syncReceive', 'syncPort', 'syncPassword'].includes(k))) state.sync.apply();
  if (keys.includes('startWithWindows')) app.setLoginItemSettings({ openAtLogin: !!settings.get('startWithWindows') });
  if (keys.some((k) => ['showInTaskbar', 'alwaysOnTop', 'transparency'].includes(k))) windows.applyWindowFlags();
  if (keys.some((k) => ['maxEntries', 'expireDays'].includes(k))) {
    state.store.applyRetention({ maxEntries: settings.get('maxEntries'), expireDays: settings.get('expireDays') });
    windows.broadcast('list:changed');
  }
  if (keys.some((k) => ['connected', 'showTray'].includes(k))) refreshTray();
  if (keys.includes('connected') && settings.get('connected')) watcher.markSelfWrite();
  windows.broadcast('settings:changed', settings.all());
}

function setupProtocol() {
  protocol.handle('crisp', (req) => {
    const u = new URL(req.url);
    const id = Number(u.pathname.replace('/', ''));
    const fmt = u.hostname === 'thumb' ? 'thumb' : 'png';
    const data = Number.isFinite(id) ? state.store.getFormat(id, fmt) : null;
    if (!data) return new Response('', { status: 404 });
    return new Response(data, { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=3600' } });
  });
}

app.on('second-instance', () => state.windows?.showPopup());

app.whenReady().then(() => {
  const store = new Store(path.join(DATA_DIR, 'crispboard.db'));
  const settings = new Settings(store);
  nativeTheme.themeSource = settings.get('theme');
  const windows = new Windows({ settings });
  const watcher = new Watcher(store, settings);
  Object.assign(state, { store, settings, windows, watcher });

  state.quit = () => { state.quitting = true; app.quit(); };
  state.api = {
    toggleConnection: () => {
      settings.set({ connected: !settings.get('connected') });
      onSettingsChanged(['connected']);
    },
  };
  state.registerHotkeys = registerHotkeys;
  state.onSettingsChanged = onSettingsChanged;

  setupProtocol();
  windows.createPopup();
  ipc.register(state);
  const sync = new Sync({ store, settings, watcher });
  state.sync = sync;
  sync.on('error', (e) => windows.broadcast('toast', { message: `Sincronizzazione: ${e.message}`, kind: 'error' }));
  sync.on('received', ({ remote, imported, skipped }) => {
    windows.broadcast('list:changed');
    windows.broadcast('toast', { message: `Ricevute ${imported + skipped} clip da ${String(remote).replace(/^::ffff:/, '')}` });
  });
  watcher.on('changed', ({ id, duplicate }) => {
    windows.broadcast('list:changed');
    if (!duplicate && settings.get('friends').some((f) => f.sendAll)) sync.sendToAll([id]);
  });
  sync.apply();
  watcher.on('error', (e) => console.error('watcher', e));
  store.applyRetention({ maxEntries: settings.get('maxEntries'), expireDays: settings.get('expireDays') });
  watcher.start();
  registerHotkeys();
  refreshTray();
  app.setLoginItemSettings({ openAtLogin: !!settings.get('startWithWindows') });

  if (process.argv.includes('--show')) windows.popup.webContents.once('did-finish-load', () => windows.showPopup());
  // Solo per verifica visiva: --screenshot=<file>[,<ritardo ms>] salva la finestra e termina.
  const shot = process.argv.find((a) => a.startsWith('--screenshot='));
  if (shot) {
    const [file, delay = '1200'] = shot.slice('--screenshot='.length).split(',');
    windows.popup.webContents.once('did-finish-load', () => {
      windows.showPopup();
      setTimeout(async () => {
        const img = await windows.popup.webContents.capturePage();
        require('node:fs').writeFileSync(file, img.toPNG());
        state.quit();
      }, Number(delay));
    });
  }
  nativeTheme.on('updated', () => windows.broadcast('settings:changed', settings.all()));
});

// L'app vive nel tray: chiudere le finestre non termina il processo.
app.on('window-all-closed', () => { /* resta attiva */ });
app.on('will-quit', () => { globalShortcut.unregisterAll(); state.watcher?.stop(); state.sync?.stop(); });
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e) => e.preventDefault());
});

process.on('uncaughtException', (err) => {
  console.error(err);
  if (app.isReady()) dialog.showErrorBox('Crispboard', String(err.stack || err));
});
