'use strict';

const DEFAULTS = {
  hotkey: 'Ctrl+Alt+V',
  globalLastTen: false,
  globalLastTenModifier: 'Ctrl+Alt',
  position: 'caret', // caret | cursor | last
  lastPosition: null,
  hideOnBlur: true,
  alwaysOnTop: true,
  showInTaskbar: false,
  transparency: 0,
  theme: 'system', // system | light | dark
  language: 'it',
  linesPerRow: 2,
  showPreview: true,
  showIndexes: true,
  markPasted: true,

  connected: true,
  respectPrivacyFormats: true,
  excludeApps: ['keepass.exe', 'keepassxc.exe', '1password.exe', 'bitwarden.exe', 'lastpass.exe', 'dashlane.exe'],
  includeApps: [],
  allowDuplicates: false,
  duplicateWindowMs: 1000,
  maxClipBytes: 0,
  descChars: 500,
  playSound: false,

  maxEntries: 500,
  expireDays: 0,

  updateOrderOnPaste: true,
  saveMultiPaste: false,
  multiSeparator: '\\n',
  multiReverse: false,
  pasteStyles: { 'mintty.exe': 'shift+insert' },
  pasteDelayMs: 60,
  confirmDelete: false,

  startWithWindows: false,
  showTray: true,
  searchMode: 'contains', // contains | regex | wildcard
  searchScope: { text: true, description: false, name: true },
};

function separatorValue(s) {
  return String(s).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\[LF\]/gi, '\n');
}

class Settings {
  constructor(store) {
    this.store = store;
    this.values = { ...DEFAULTS, ...store.getSettings() };
  }

  get(key) { return this.values[key]; }
  all() { return { ...this.values }; }

  set(patch) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in DEFAULTS)) continue;
      if (JSON.stringify(this.values[k]) === JSON.stringify(v)) continue;
      this.values[k] = v;
      this.store.setSetting(k, v);
      changed.push(k);
    }
    return changed;
  }
}

module.exports = { Settings, DEFAULTS, separatorValue };
