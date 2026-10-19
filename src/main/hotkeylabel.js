'use strict';
// "Ctrl+'" -> "Ctrl+À" (italiano) / "Ctrl+Ä" (tedesco): mostra il carattere che il tasto ha nel layout attivo.
const win32 = require('./win32');

const OEM_VK = { ';': 0xba, '=': 0xbb, ',': 0xbc, '-': 0xbd, '.': 0xbe, '/': 0xbf, '`': 0xc0, '[': 0xdb, '\\': 0xdc, ']': 0xdd, "'": 0xde };

function prettyAccel(accel, hkl = null) {
  if (!accel) return '';
  const parts = accel.split('+');
  // "Ctrl++" non esiste: il tasto '+' non è un acceleratore valido, quindi l'ultimo elemento è sempre il tasto
  const key = parts.pop();
  const isLetter = /^[A-Z]$/.test(key);
  const vk = OEM_VK[key] ?? (isLetter ? key.charCodeAt(0) : null);
  const ch = !vk ? null : isLetter ? win32.letterLabel(vk, hkl) : win32.keyLabel(vk, hkl);
  // toUpperCase solo se resta un carattere ("ß" diventerebbe "SS")
  const up = ch && ch.toUpperCase().length === 1 ? ch.toUpperCase() : ch;
  return [...parts, up || key].join('+');
}

module.exports = { prettyAccel, OEM_VK };
