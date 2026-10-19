'use strict';
// Decodifica pura dei formati clipboard di Windows (senza Electron, testabile da Node).

function utf16z(buf) {
  if (!buf) return '';
  let end = buf.length - (buf.length % 2);
  for (let i = 0; i < end; i += 2) if (buf[i] === 0 && buf[i + 1] === 0) { end = i; break; }
  return buf.toString('utf16le', 0, end);
}

function cstr(buf) {
  if (!buf) return '';
  const z = buf.indexOf(0);
  return buf.toString('utf8', 0, z < 0 ? buf.length : z);
}

function parseHtmlFormat(buf) {
  const raw = cstr(buf);
  if (!raw) return { fragment: '', url: null };
  const num = (k) => { const m = new RegExp(`${k}:(\\d+)`).exec(raw); return m ? Number(m[1]) : -1; };
  const sf = num('StartFragment');
  const ef = num('EndFragment');
  const url = (/SourceURL:(\S+)/.exec(raw) || [])[1] || null;
  const bytes = Buffer.from(raw, 'utf8');
  const fragment = sf >= 0 && ef > sf ? bytes.toString('utf8', sf, ef) : raw.replace(/^[\s\S]*?<html/i, '<html');
  return { fragment, url };
}

module.exports = { utf16z, cstr, parseHtmlFormat };
