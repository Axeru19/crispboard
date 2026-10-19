'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { apply } = require('../src/main/transforms.js');
const { Store } = require('../src/main/db.js');
const { exportClips, importClips } = require('../src/main/exporter.js');
const { separatorValue } = require('../src/main/settings.js');

test('trasformazioni di testo', () => {
  assert.equal(apply('upper', 'ciao Mondo'), 'CIAO MONDO');
  assert.equal(apply('lower', 'CIAO Mondo'), 'ciao mondo');
  assert.equal(apply('capitalize', 'ciao mondo bello'), 'Ciao Mondo Bello');
  assert.equal(apply('sentence', 'ciao mondo. come stai? bene'), 'Ciao mondo. Come stai? Bene');
  assert.equal(apply('invert', 'aBc'), 'AbC');
  assert.equal(apply('camel', 'ciao mondo bello'), 'ciaoMondoBello');
  assert.equal(apply('slug', 'Perché è così? Sì!'), 'perche-e-cosi-si');
  assert.equal(apply('oneLine', 'a\nb\r\nc'), 'a b c');
  assert.equal(apply('trim', '  x  '), 'x');
  assert.equal(apply('ascii', 'caffè'), 'caffe');
  assert.equal(apply('addLF1', 'x'), 'x\n');
  assert.equal(apply('addLF2', 'x'), 'x\n\n');
  assert.match(apply('addTime', 'x '), /^x \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  const t = apply('typoglycemia', 'ciao informazione');
  assert.equal(t.length, 'ciao informazione'.length);
  assert.ok(t.startsWith('c') && t.includes('i') && t.endsWith('e'));
  assert.equal(apply('inesistente', 'x'), 'x');
});

test('separatore multi-incolla', () => {
  assert.equal(separatorValue('\n'), '\n');
  assert.equal(separatorValue('[LF]'), '\n');
  assert.equal(separatorValue(', '), ', ');
});

function mk(text) {
  const buf = Buffer.from(text);
  return { kind: 'text', hash: Store.hashOf(['text', buf]), preview: text, searchText: text, size: buf.length, source: { exe: 'x.exe' }, formats: [{ format: 'text', data: buf }, { format: 'html', data: Buffer.from('<i>' + text + '</i>') }] };
}

test('export e import: round trip con pin, etichette e formati', () => {
  const a = new Store(':memory:');
  const id = a.addClip(mk('uno')).id;
  a.addClip(mk('due'));
  const l = a.createLabel('Lavoro', '#123456');
  a.assignLabel([id], [l], 'add');
  a.setPinned(id, true);
  const json = exportClips(a);

  const b = new Store(':memory:');
  const r = importClips(b, json);
  assert.equal(r.imported, 2);
  assert.equal(r.skipped, 0);
  assert.equal(r.ids.length, 2);
  const rows = b.list().rows;
  assert.equal(rows.length, 2);
  const pinned = rows.find((x) => x.pinned);
  assert.equal(pinned.preview, 'uno');
  assert.equal(b.listLabels()[0].name, 'Lavoro');
  assert.equal(b.getClip(pinned.id).labels.length, 1);
  assert.equal(b.getFormat(pinned.id, 'html').toString(), '<i>uno</i>');
  const again = importClips(b, json);
  assert.equal(again.imported, 0);
  assert.equal(again.skipped, 2);
  assert.throws(() => importClips(b, '{"x":1}'));
  assert.throws(() => importClips(b, 'non json'));
});

test('retention per scadenza elimina solo non fissate', () => {
  const s = new Store(':memory:');
  const old = s.addClip(mk('vecchia')).id;
  const pinned = s.addClip(mk('fissata')).id;
  s.db.prepare('UPDATE clips SET created_at=?').run(Date.now() - 40 * 86400000);
  s.setPinned(pinned, true);
  const removed = s.applyRetention({ expireDays: 30 });
  assert.equal(removed, 1);
  assert.equal(s.getClip(old), null);
  assert.ok(s.getClip(pinned));
});

test('markUsed, deleteUnused e statistiche', () => {
  const s = new Store(':memory:');
  const a = s.addClip(mk('a')).id;
  s.addClip(mk('b'));
  s.markUsed(a, { reorder: true });
  assert.equal(s.deleteUnused(), 1);
  assert.equal(s.stats().clips, 1);
  assert.equal(s.stats().pastes, 1);
});

test('cancellazione clip rimuove formati ed etichette (cascade)', () => {
  const s = new Store(':memory:');
  const a = s.addClip(mk('a')).id;
  const l = s.createLabel('x', '#000');
  s.assignLabel([a], [l], 'add');
  s.delete([a]);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM formats').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) n FROM clip_labels').get().n, 0);
});

test('sync: cifratura AES-GCM, password errata rifiutata, manomissione rilevata', () => {
  const { encrypt, decrypt } = require('../src/main/synccrypto.js');
  const msg = encrypt('segreta', 'contenuto riservato');
  assert.equal(decrypt('segreta', msg), 'contenuto riservato');
  assert.throws(() => decrypt('sbagliata', msg));
  const m = JSON.parse(msg);
  m.data = Buffer.from('xxxxxxxxxxxxxxxxxxx').toString('base64');
  assert.throws(() => decrypt('segreta', JSON.stringify(m)));
});

test('backup su file e riapertura', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-'));
  const s = new Store(path.join(dir, 'a.db'));
  const id = s.addClip(mk('da salvare')).id;
  s.setPinned(id, true);
  const bk = path.join(dir, 'b.db');
  s.backupTo(bk);
  s.close();
  const r = new Store(bk);
  assert.equal(r.list().total, 1);
  assert.equal(r.list().rows[0].pinned, 1);
  r.compact();
  r.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
