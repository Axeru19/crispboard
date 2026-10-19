// Converte un KeyboardEvent in un acceleratore di Electron (globalShortcut) usando il virtual key di Windows
// (e.keyCode), che dipende dal layout attivo: il tasto con scritto "Z" sulla tastiera tedesca dà VK_Z, il tasto
// "à" italiano dà VK_OEM_7. Né e.key (carattere, spesso non ASCII) né e.code (posizione fisica, sbagliata sui
// layout non QWERTY come AZERTY o QWERTZ) darebbero il tasto che l'utente intende.
// Chromium traduce i caratteri ASCII dell'acceleratore nello stesso VK (tabella OEM sotto, uguale a quella di Chromium).

export const OEM = {
  0xba: ';', 0xbb: '=', 0xbc: ',', 0xbd: '-', 0xbe: '.', 0xbf: '/', 0xc0: '`',
  0xdb: '[', 0xdc: '\\', 0xdd: ']', 0xde: "'",
};
const NAMED = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0d: 'Enter', 0x14: 'Capslock', 0x1b: 'Esc', 0x20: 'Space',
  0x21: 'PageUp', 0x22: 'PageDown', 0x23: 'End', 0x24: 'Home', 0x25: 'Left', 0x26: 'Up', 0x27: 'Right', 0x28: 'Down',
  0x2c: 'PrintScreen', 0x2d: 'Insert', 0x2e: 'Delete',
  0x6a: 'nummult', 0x6b: 'numadd', 0x6d: 'numsub', 0x6e: 'numdec', 0x6f: 'numdiv',
  0x90: 'Numlock', 0x91: 'Scrolllock',
};

export const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'];

/** Nome del tasto per Electron dal virtual key, o null se non rappresentabile (es. IME 229, tasto "<>" ISO = 0xE2). */
export function keyFromVk(vk) {
  if (vk >= 0x41 && vk <= 0x5a) return String.fromCharCode(vk); // A-Z
  if (vk >= 0x30 && vk <= 0x39) return String.fromCharCode(vk); // 0-9
  if (vk >= 0x70 && vk <= 0x87) return 'F' + (vk - 0x6f); // F1-F24
  if (vk >= 0x60 && vk <= 0x69) return 'num' + (vk - 0x60);
  return OEM[vk] ?? NAMED[vk] ?? null;
}

/** Restituisce l'acceleratore ("Ctrl+Alt+V"), oppure null (solo modificatori, nessun modificatore o tasto non supportato). */
export function accelFromEvent(e) {
  if (MODIFIER_KEYS.includes(e.key)) return null;
  const key = keyFromVk(e.keyCode);
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
export const isUnsupported = (e) => !MODIFIER_KEYS.includes(e.key) && !keyFromVk(e.keyCode);

/**
 * Etichetta da mostrare per l'acceleratore appena registrato: il carattere inciso sul tasto nel layout dell'utente
 * ("Ctrl+À" per l'accel "Ctrl+'"). Senza Maiusc/AltGr e.key è il carattere vero del tasto (Chromium lo traduce con il
 * layout attivo); altrimenti si usa la mappa del layout sulla posizione fisica. Lettere latine, cifre, F-n e tasti
 * con nome restano com'è: il testo del tasto coincide già con l'acceleratore.
 */
export async function labelFromEvent(e, accel) {
  const parts = accel.split('+');
  const key = parts.pop();
  let ch = !e.shiftKey && !(e.altKey && e.ctrlKey) && e.key.length === 1 ? e.key : null; // Maiusc e AltGr (Ctrl+Alt) cambiano e.key
  if (!ch) {
    try { ch = (await navigator.keyboard.getLayoutMap()).get(e.code) ?? null; } catch { /* API non disponibile */ }
  }
  const useChar = ch && ch.length === 1 && (Object.values(OEM).includes(key) || (/^[A-Z]$/.test(key) && ch.charCodeAt(0) > 127));
  const up = useChar ? (ch.toUpperCase().length === 1 ? ch.toUpperCase() : ch) : key;
  return [...parts, up].join('+');
}
