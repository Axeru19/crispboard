'use strict';
const { BrowserWindow, screen, nativeTheme } = require('electron');
const path = require('node:path');
const win32 = require('./win32');

const ROOT = path.join(__dirname, '..', '..');
const POPUP_SIZE = { width: 780, height: 520 };
const BG = { dark: '#141b1d', light: '#f6fafa' };

function bgColor() { return nativeTheme.shouldUseDarkColors ? BG.dark : BG.light; }

class Windows {
  constructor(ctx) {
    this.ctx = ctx; // {settings}
    this.popup = null;
    this.settingsWin = null;
    this.target = null; // finestra che aveva il focus prima del popup
    this.moveTimer = null;
    this.shownAt = 0;
  }

  webPrefs() {
    return {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    };
  }

  createPopup() {
    const s = this.ctx.settings;
    const last = s.get('lastPosition');
    const win = new BrowserWindow({
      ...POPUP_SIZE,
      ...(last && last.width ? { width: last.width, height: last.height } : {}),
      minWidth: 520, minHeight: 340,
      show: false, frame: false, resizable: true, maximizable: false, minimizable: false, fullscreenable: false,
      skipTaskbar: !s.get('showInTaskbar'),
      alwaysOnTop: s.get('alwaysOnTop'),
      backgroundColor: bgColor(),
      icon: path.join(ROOT, 'assets', 'icon.png'),
      title: 'Crispboard',
      webPreferences: this.webPrefs(),
    });
    win.setMenuBarVisibility(false);
    win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
    win.on('blur', () => {
      if (!s.get('hideOnBlur') || this.suppressBlur) return;
      if (Date.now() - this.shownAt < 250) return;
      this.hidePopup();
    });
    const persist = () => {
      clearTimeout(this.moveTimer);
      this.moveTimer = setTimeout(() => {
        if (!win.isVisible()) return;
        s.set({ lastPosition: win.getBounds() });
      }, 400);
    };
    win.on('moved', persist);
    win.on('resized', persist);
    this.popup = win;
    this.applyOpacity();
    return win;
  }

  applyOpacity() {
    if (!this.popup) return;
    const t = Math.min(60, Math.max(0, Number(this.ctx.settings.get('transparency')) || 0));
    this.popup.setOpacity(1 - t / 100);
  }

  applyWindowFlags() {
    if (!this.popup) return;
    const s = this.ctx.settings;
    this.popup.setSkipTaskbar(!s.get('showInTaskbar'));
    this.popup.setAlwaysOnTop(!!s.get('alwaysOnTop'));
    this.applyOpacity();
  }

  position() {
    const s = this.ctx.settings;
    const [w, h] = this.popup.getSize();
    const mode = s.get('position');
    const last = s.get('lastPosition');
    let pt = null;
    if (mode === 'last' && last && last.x != null) {
      const d = screen.getDisplayMatching(last);
      pt = { x: last.x, y: last.y, display: d };
    } else {
      let phys = mode === 'caret' ? win32.caretScreenPos() : null;
      let p;
      if (phys) {
        p = screen.screenToDipPoint(phys);
        p = { x: p.x, y: p.y + 6 };
      } else {
        p = screen.getCursorScreenPoint();
        p = { x: p.x - 24, y: p.y + 12 };
      }
      pt = { ...p, display: screen.getDisplayNearestPoint(p) };
    }
    const wa = pt.display.workArea;
    const x = Math.min(Math.max(pt.x, wa.x + 8), wa.x + wa.width - w - 8);
    const y = Math.min(Math.max(pt.y, wa.y + 8), wa.y + wa.height - h - 8);
    return { x: Math.round(x), y: Math.round(y) };
  }

  isPopupVisible() { return !!this.popup && this.popup.isVisible(); }

  showPopup() {
    if (!this.popup) return;
    const fg = win32.foregroundWindow();
    this.target = fg;
    const { x, y } = this.position();
    this.popup.setPosition(x, y, false);
    this.shownAt = Date.now();
    this.popup.show();
    this.popup.focus();
    this.popup.webContents.send('popup:show');
  }

  hidePopup() {
    if (this.popup && this.popup.isVisible()) {
      this.popup.hide();
      this.popup.webContents.send('popup:hide');
    }
  }

  togglePopup() {
    if (this.isPopupVisible()) this.hidePopup();
    else this.showPopup();
  }

  openSettings(tab) {
    if (this.settingsWin && !this.settingsWin.isDestroyed()) {
      this.settingsWin.show(); this.settingsWin.focus();
      if (tab) this.settingsWin.webContents.send('settings:tab', tab);
      return;
    }
    const dark = nativeTheme.shouldUseDarkColors;
    const win = new BrowserWindow({
      width: 820, height: 600, minWidth: 700, minHeight: 480,
      show: false, autoHideMenuBar: true,
      backgroundColor: bgColor(),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: bgColor(), symbolColor: dark ? '#e6efef' : '#1c2426', height: 40 },
      icon: path.join(ROOT, 'assets', 'icon.png'),
      title: 'Impostazioni di Crispboard',
      webPreferences: this.webPrefs(),
    });
    win.loadFile(path.join(ROOT, 'src', 'renderer', 'settings.html'), { query: tab ? { tab } : {} });
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => { this.settingsWin = null; });
    this.settingsWin = win;
  }

  broadcast(channel, payload) {
    for (const w of [this.popup, this.settingsWin]) {
      if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
    }
  }
}

module.exports = { Windows };
