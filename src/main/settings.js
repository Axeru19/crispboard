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
  layout: 'auto', // auto | side | stack | list
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

  // Buffer di copia (3): scorciatoie globali di copia/taglia/incolla in uno slot dedicato.
  cbCopy1: '', cbCut1: '', cbPaste1: '', cbCopy2: '', cbCut2: '', cbPaste2: '', cbCopy3: '', cbCut3: '', cbPaste3: '',
  bufferClips: {},

  // Sincronizzazione LAN (cifrata con password condivisa)
  syncReceive: false,
  syncPort: 23443,
  syncPassword: '',
  syncAcceptToClipboard: true,
  friends: [], // [{name, host, port, sendAll}]

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
    const saved = store.getSettings();
    this.values = { ...DEFAULTS, ...saved };
    if (saved.showPreview === false && !saved.layout) this.values.layout = 'list'; // migrazione da <= alpha.2
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
