'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Store } = require('../src/main/db.js');

function clip(text, extra = {}) {
  const buf = Buffer.from(text);
  return {
    kind: 'text', hash: Store.hashOf(['text', buf]), preview: text, searchText: text.toLowerCase(),
    size: buf.length, source: { exe: 'notepad.exe' }, formats: [{ format: 'text', data: buf }], ...extra,
  };
}

test('inserimento, lista e ordine', () => {
  const s = new Store(':memory:');
  s.addClip(clip('uno')); s.addClip(clip('due')); s.addClip(clip('tre'));
  const { rows, total } = s.list();
  assert.equal(total, 3);
  assert.deepEqual(rows.map((r) => r.preview), ['tre', 'due', 'uno']);
});

test('ricerca contains, wildcard, regex', () => {
  const s = new Store(':memory:');
  ['Fattura 2024-001', 'ciao mondo', 'Ordine A7'].forEach((t) => s.addClip(clip(t)));
  assert.equal(s.list({ query: 'FATTURA' }).total, 1);
  assert.equal(s.list({ query: 'c*o', mode: 'wildcard' }).total, 1);
  assert.equal(s.list({ query: String.raw`\d{4}-\d+`, mode: 'regex' }).total, 1);
  assert.equal(s.list({ query: '(', mode: 'regex' }).error != null, true);
  assert.equal(s.list({ query: '100%' }).total, 0);
});

test('pin in cima e esente da retention', () => {
  const s = new Store(':memory:');
  const a = s.addClip(clip('vecchia importante')).id;
  for (let i = 0; i < 5; i++) s.addClip(clip('r' + i));
  s.setPinned(a, true);
  assert.equal(s.list().rows[0].id, a);
  s.applyRetention({ maxEntries: 2 });
  const ids = s.list().rows.map((r) => r.id);
  assert.ok(ids.includes(a));
  assert.equal(s.list().total, 3);
  s.applyRetention({ expireDays: 1 });
  assert.ok(s.getClip(a));
  s.deleteAll({ keepPinned: true });
  assert.equal(s.list().total, 1);
});

test('etichette multiple e filtro', () => {
  const s = new Store(':memory:');
  const a = s.addClip(clip('a')).id; const b = s.addClip(clip('b')).id;
  const l1 = s.createLabel('Lavoro', '#f00'); const l2 = s.createLabel('Link', '#0f0');
  s.assignLabel([a, b], [l1], 'add');
  s.assignLabel([a], [l2], 'toggle');
  assert.deepEqual(s.getClip(a).labels.sort(), [l1, l2].sort());
  assert.equal(s.list({ labelIds: [l1] }).total, 2);
  assert.equal(s.list({ labelIds: [l2] }).total, 1);
  s.assignLabel([a], [l2], 'toggle');
  assert.equal(s.list({ labelIds: [l2] }).total, 0);
  s.deleteLabel(l1);
  assert.equal(s.getClip(a).labels.length, 0);
});

test('modifica in-place sostituisce testo e scarta html', () => {
  const s = new Store(':memory:');
  const c = clip('ciao');
  c.formats.push({ format: 'html', data: Buffer.from('<b>ciao</b>') });
  const id = s.addClip(c).id;
  s.updateText(id, 'ciao mondo');
  assert.equal(s.getText(id), 'ciao mondo');
  assert.equal(s.getFormat(id, 'html'), null);
  assert.equal(s.getClip(id).edited, 1);
  assert.equal(s.list({ query: 'mondo' }).total, 1);
});

test('riordino manuale', () => {
  const s = new Store(':memory:');
  const a = s.addClip(clip('a')).id; const b = s.addClip(clip('b')).id; const c = s.addClip(clip('c')).id;
  s.move(a, 'top');
  assert.equal(s.list().rows[0].id, a);
  s.move(a, 'down');
  assert.deepEqual(s.list().rows.map((r) => r.id), [c, a, b]);
  s.move(a, 'up');
  assert.equal(s.list().rows[0].id, a);
});
