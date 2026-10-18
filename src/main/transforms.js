'use strict';
// Incolla speciale: trasformazioni pure sul testo.

const words = (s) => s.split(/(\s+)/);

function capitalize(s) {
  return s.replace(/\p{L}[\p{L}\p{N}'’]*/gu, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
}

function sentence(s) {
  const lower = s.toLowerCase();
  return lower.replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, pre, ch) => pre + ch.toUpperCase());
}

function invert(s) {
  return [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join('');
}

function camel(s) {
  const parts = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return parts.map((p, i) => (i ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.toLowerCase())).join('');
}

function slugify(s, sep = '-') {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, sep).replace(new RegExp(`^${sep}+|${sep}+$`, 'g'), '');
}

/** Typoglycemia: mescola le lettere interne di ogni parola, mantenendo prima e ultima. */
function typoglycemia(s, rnd = Math.random) {
  return s.replace(/\p{L}{4,}/gu, (w) => {
    const a = [...w];
    const mid = a.slice(1, -1);
    for (let i = mid.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [mid[i], mid[j]] = [mid[j], mid[i]];
    }
    return a[0] + mid.join('') + a[a.length - 1];
  });
}

const asciiOnly = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e\r\n\t]/g, '');

function pad(n) { return String(n).padStart(2, '0'); }
function nowStamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const TRANSFORMS = {
  upper: (s) => s.toUpperCase(),
  lower: (s) => s.toLowerCase(),
  capitalize,
  sentence,
  invert,
  camel,
  slug: (s) => slugify(s),
  typoglycemia: (s) => typoglycemia(s),
  oneLine: (s) => s.replace(/\r?\n|\r/g, ' ').replace(/ {2,}/g, ' ').trim(),
  trim: (s) => s.trim(),
  ascii: asciiOnly,
  addLF1: (s) => s + '\n',
  addLF2: (s) => s + '\n\n',
  addTime: (s) => s + nowStamp(),
};

const TRANSFORM_LABELS = [
  ['upper', 'MAIUSCOLO'], ['lower', 'minuscolo'], ['capitalize', 'Iniziali Maiuscole'],
  ['sentence', 'Frase normale'], ['invert', 'iNVERTI cASE'], ['camel', 'camelCase'], ['slug', 'slug-url'],
  ['oneLine', 'Su una riga'], ['trim', 'Senza spazi ai bordi'], ['ascii', 'Solo ASCII'],
  ['addLF1', 'Aggiungi a capo'], ['addLF2', 'Aggiungi due a capo'], ['addTime', 'Aggiungi data e ora'],
  ['typoglycemia', 'Typoglycemia'],
];

function apply(name, text) {
  const fn = TRANSFORMS[name];
  return fn ? fn(text) : text;
}

module.exports = { apply, TRANSFORMS, TRANSFORM_LABELS, words };
