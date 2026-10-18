'use strict';
// Popola un database di prova: node scripts/seed-demo.js <cartella-dati>
const path = require('node:path');
const { Store } = require('../src/main/db');

const dir = process.argv[2];
if (!dir) { console.error('uso: node scripts/seed-demo.js <cartella-dati>'); process.exit(1); }
const store = new Store(path.join(dir, 'crispboard.db'));

const clip = (text, extra = {}) => {
  const buf = Buffer.from(text, 'utf8');
  return {
    kind: 'text', hash: Store.hashOf(['text', buf]), preview: text.replace(/\s+/g, ' ').trim().slice(0, 500),
    searchText: text.toLowerCase(), size: buf.length, source: { exe: extra.app || 'chrome.exe' },
    formats: [{ format: 'text', data: buf }],
  };
};

const lavoro = store.createLabel('Lavoro', '#4aa8e8');
const codice = store.createLabel('Codice', '#7b86f0');
const link = store.createLabel('Link', '#5fbf6a');
const personale = store.createLabel('Personale', '#e56fb0');

const items = [
  ['IT76 X054 2811 1010 0000 0123 456', { app: 'chrome.exe', labels: [personale], pin: true }],
  ['Buongiorno Marta,\ncome da accordi ti invio in allegato il preventivo aggiornato. Resto a disposizione per qualsiasi chiarimento.\nCordiali saluti, Axel', { app: 'olk.exe', labels: [lavoro], pin: true }],
  ['https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/oklch', { app: 'chrome.exe', labels: [link] }],
  ['const rows = db.prepare("SELECT * FROM clips WHERE pinned = 1").all();\nfor (const r of rows) { console.log(r.id); }', { app: 'Code.exe', labels: [codice] }],
  ['npm run build && npm test -- --watch=false', { app: 'WindowsTerminal.exe', labels: [codice, lavoro] }],
  ['Riunione di allineamento giovedì alle 15:30, sala Mercurio. Portare i numeri del trimestre.', { app: 'Teams.exe', labels: [lavoro] }],
  ['SELECT id, preview FROM clips ORDER BY sort_order DESC LIMIT 20;', { app: 'ssms.exe', labels: [codice] }],
  ['https://github.com/electron/electron/releases', { app: 'msedge.exe', labels: [link] }],
  ['Fattura 2026-0148 - Studio Ferraris - 1.240,00 EUR', { app: 'excel.exe', labels: [lavoro] }],
  ['lista della spesa: latte, pane, basilico, parmigiano, caffè', { app: 'notepad.exe', labels: [personale] }],
];
let n = 0;
for (const [text, o] of items.reverse()) {
  const { id } = store.addClip(clip(text, o));
  store.db.prepare('UPDATE clips SET created_at=? WHERE id=?').run(Date.now() - (++n) * 7 * 60000, id);
  if (o.labels) store.assignLabel([id], o.labels, 'add');
  if (o.pin) store.setPinned(id, true);
}
console.log('seed ok:', store.stats());
store.close();
