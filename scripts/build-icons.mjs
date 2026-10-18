// Estrae da Phosphor le sole icone usate e genera src/renderer/icons.js (nessuna richiesta di rete a runtime).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = path.join(root, 'node_modules', '@phosphor-icons', 'core', 'assets');

const regular = [
  'magnifying-glass', 'push-pin', 'text-t', 'image', 'files', 'link', 'code', 'tag', 'trash', 'pencil-simple',
  'gear-six', 'x', 'check', 'plus', 'copy', 'arrow-elbow-down-left', 'keyboard', 'clipboard-text', 'dots-three',
  'file-text', 'eye', 'arrow-counter-clockwise', 'floppy-disk', 'export', 'upload-simple', 'download-simple',
  'pause', 'play', 'text-aa', 'lock-simple', 'caret-down', 'sliders-horizontal', 'database', 'palette',
  'clock-counter-clockwise', 'prohibit', 'info', 'warning-circle', 'arrow-up', 'arrow-down', 'text-aa',
];
const fill = ['push-pin'];

const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const out = {};
for (const n of new Set(regular)) out[n] = inner(fs.readFileSync(path.join(base, 'regular', `${n}.svg`), 'utf8'));
for (const n of fill) out[`${n}-fill`] = inner(fs.readFileSync(path.join(base, 'fill', `${n}-fill.svg`), 'utf8'));

const js = `// GENERATO da scripts/build-icons.mjs (Phosphor Icons, MIT). Non modificare a mano.
window.ICONS = ${JSON.stringify(out)};
window.icon = (name, cls = '') =>
  \`<svg class="ic \${cls}" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">\${window.ICONS[name] || ''}</svg>\`;
`;
fs.writeFileSync(path.join(root, 'src', 'renderer', 'icons.js'), js);
console.log('icone:', Object.keys(out).length);
