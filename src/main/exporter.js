'use strict';
// Export/import delle clip in JSON (blob in base64) e export testo/immagine.

function exportClips(store, ids = null) {
  const all = ids || store.db.prepare('SELECT id FROM clips ORDER BY sort_order ASC').all().map((r) => r.id);
  const labels = store.listLabels();
  const labelName = new Map(labels.map((l) => [l.id, l.name]));
  const clips = [];
  for (const id of all) {
    const c = store.db.prepare('SELECT * FROM clips WHERE id=?').get(id);
    if (!c) continue;
    clips.push({
      created_at: c.created_at, last_used_at: c.last_used_at, use_count: c.use_count, kind: c.kind,
      preview: c.preview, search_text: c.search_text, hash: c.hash, size: c.size,
      pinned: c.pinned, pin_order: c.pin_order, never_delete: c.never_delete, quick_name: c.quick_name,
      source_app: c.source_app, source_title: c.source_title, source_url: c.source_url, edited: c.edited,
      labels: (store.labelsFor([id]).get(id) || []).map((l) => labelName.get(l)),
      formats: store.getFormats(id).map((f) => ({ format: f.format, data: f.data.toString('base64') })),
    });
  }
  return JSON.stringify({ app: 'crispboard', version: 1, exportedAt: Date.now(),
    labels: labels.map((l) => ({ name: l.name, color: l.color })), clips });
}

/** Restituisce {imported, skipped}. Le clip con hash già presente vengono saltate. */
function importClips(store, json) {
  let doc;
  try { doc = JSON.parse(json); } catch { throw new Error('File non valido'); }
  if (doc.app !== 'crispboard' || !Array.isArray(doc.clips)) throw new Error('Formato non riconosciuto');
  const existing = new Map(store.listLabels().map((l) => [l.name.toLowerCase(), l.id]));
  for (const l of doc.labels || []) {
    if (!existing.has(l.name.toLowerCase())) existing.set(l.name.toLowerCase(), store.createLabel(l.name, l.color));
  }
  let imported = 0;
  let skipped = 0;
  for (const c of doc.clips) {
    if (store.findByHash(c.hash)) { skipped++; continue; }
    const { id } = store.addClip({
      kind: c.kind, hash: c.hash, preview: c.preview, searchText: c.search_text, size: c.size,
      source: { exe: c.source_app, title: c.source_title, url: c.source_url },
      formats: c.formats.map((f) => ({ format: f.format, data: Buffer.from(f.data, 'base64') })),
    });
    store.db.prepare('UPDATE clips SET created_at=?, last_used_at=?, use_count=?, never_delete=?, quick_name=?, edited=? WHERE id=?')
      .run(c.created_at, c.last_used_at ?? null, c.use_count ?? 0, c.never_delete ?? 0, c.quick_name ?? null, c.edited ?? 0, id);
    if (c.pinned) store.setPinned(id, true);
    const lids = (c.labels || []).map((n) => existing.get(String(n).toLowerCase())).filter(Boolean);
    if (lids.length) store.assignLabel([id], lids, 'add');
    imported++;
  }
  return { imported, skipped };
}

function exportText(store, ids) {
  return ids.map((id) => store.getText(id) ?? '').filter(Boolean).join('\n\n');
}

module.exports = { exportClips, importClips, exportText };
