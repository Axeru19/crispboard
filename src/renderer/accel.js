// Converte un KeyboardEvent in un acceleratore di Electron (globalShortcut) usando il tasto FISICO (e.code).
// Con e.key un tasto come "à" (layout italiano) diventerebbe "Ctrl+À", che Electron rifiuta; il codice fisico
// dà invece un nome ASCII che Chromium mappa sullo stesso virtual key (OEM_7 = "à" in italiano).

const PUNCT = {
  Semicolon: ';', Equal: '=', Comma: ',', Minus: '-', Period: '.', Slash: '/',
  Backquote: '`', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Quote: "'",
};
const NAMED = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Esc',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  PrintScreen: 'PrintScreen', ScrollLock: 'Scrolllock', NumLock: 'Numlock', CapsLock: 'Capslock',
};

export const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'];

/** Nome del tasto per Electron, o null se non rappresentabile. */
export function keyFromCode(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
  if ((m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code))) return code;
  if ((m = /^Numpad([0-9])$/.exec(code))) return 'num' + m[1];
  return PUNCT[code] ?? NAMED[code] ?? null;
}

/** Restituisce l'acceleratore ("Ctrl+Alt+V"), oppure null (solo modificatori, nessun modificatore o tasto non supportato). */
export function accelFromEvent(e) {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  const key = keyFromCode(e.code);
  const mods = [];
  // AltGr su layout italiano = Ctrl+Alt: e.ctrlKey/e.altKey sono entrambi veri.
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!key || !mods.length) return null;
  return [...mods, key].join('+');
}

/** true se il tasto premuto non è un modificatore ma non si può usare (per avvisare l'utente). */
export const isUnsupported = (e) => !MODIFIER_KEYS.includes(e.key) && !keyFromCode(e.code);
