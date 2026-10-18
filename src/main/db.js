'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clips(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  use_count INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  preview TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  hash TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  pin_order REAL NOT NULL DEFAULT 0,
  sort_order REAL NOT NULL,
  never_delete INTEGER NOT NULL DEFAULT 0,
  quick_name TEXT,
  hotkey TEXT,
  source_app TEXT,
  source_title TEXT,
  source_url TEXT,
  edited INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS formats(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  format TEXT NOT NULL,
  data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS labels(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  color TEXT NOT NULL,
  position REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS clip_labels(
  clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY(clip_id, label_id)
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_clips_order ON clips(pinned DESC, pin_order DESC, sort_order DESC);
CREATE INDEX IF NOT EXISTS idx_clips_hash ON clips(hash);
CREATE INDEX IF NOT EXISTS idx_formats_clip ON formats(clip_id, format);
CREATE INDEX IF NOT EXISTS idx_clip_labels_label ON clip_labels(label_id);
`;

const LIST_COLUMNS = `c.id, c.created_at, c.last_used_at, c.use_count, c.kind, c.preview, c.size, c.pinned,
  c.never_delete, c.quick_name, c.hotkey, c.source_app, c.source_title, c.edited`;

function escapeLike(s) { return s.replace(/[\\%_]/g, (m) => '\\' + m); }

function wildcardToLike(q) {
  return '%' + escapeLike(q).replace(/\*/g, '%').replace(/\?/g, '_') + '%';
}

function makeRegexp(pattern, caseInsensitive) {
  try { return new RegExp(pattern, caseInsensitive ? 'i' : ''); } catch { return null; }
}

class Store {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;');
    this.db.exec(SCHEMA);
    this._rx = null;
    this.db.function('crisp_rx', { deterministic: false }, (text) => (this._rx && this._rx.test(text) ? 1 : 0));
  }

  close() { this.db.close(); }

  /** Valore d'ordinamento strettamente crescente anche per copie nello stesso millisecondo. */
  nextOrder() {
    const max = this.db.prepare('SELECT COALESCE(MAX(sort_order),0) AS m FROM clips').get().m;
    return Math.max(Date.now(), max + 1);
  }

  // ---- impostazioni ----
  getSettings() {
    const out = {};
    for (const r of this.db.prepare('SELECT key, value FROM settings').all()) {
      try { out[r.key] = JSON.parse(r.value); } catch { /* valore corrotto: ignorato */ }
    }
    return out;
  }

  setSetting(key, value) {
    this.db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }

  // ---- inserimento ----
  static hashOf(parts) {
    const h = crypto.createHash('sha1');
    for (const p of parts) h.update(p);
    return h.digest('hex');
  }

  findByHash(hash) {
    return this.db.prepare('SELECT id, created_at, last_used_at, pinned FROM clips WHERE hash=? ORDER BY id DESC LIMIT 1').get(hash);
  }

  /**
   * clip: {kind, hash, preview, searchText, size, source, formats:[{format,data:Buffer}]}
   * Restituisce {id}.
   */
  addClip(clip) {
    const now = Date.now();
    const db = this.db;
    db.exec('BEGIN');
    try {
      const info = db.prepare(`INSERT INTO clips(created_at,kind,preview,search_text,hash,size,sort_order,source_app,source_title,source_url)
        VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
        now, clip.kind, clip.preview, clip.searchText, clip.hash, clip.size, this.nextOrder(),
        clip.source?.exe ?? null, clip.source?.title ?? null, clip.source?.url ?? null);
      const id = Number(info.lastInsertRowid);
      const ins = db.prepare('INSERT INTO formats(clip_id,format,data) VALUES(?,?,?)');
      for (const f of clip.formats) ins.run(id, f.format, f.data);
      db.exec('COMMIT');
      return { id };
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }

  /** Riporta in cima una clip esistente (duplicato). */
  bump(id) {
    this.db.prepare('UPDATE clips SET sort_order=? WHERE id=?').run(this.nextOrder(), id);
  }

  // ---- lettura ----
  labelsFor(ids) {
    if (!ids.length) return new Map();
    const rows = this.db.prepare(`SELECT clip_id, label_id FROM clip_labels WHERE clip_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.clip_id)) map.set(r.clip_id, []);
      map.get(r.clip_id).push(r.label_id);
    }
    return map;
  }

  /**
   * opts: {query, mode:'contains'|'regex'|'wildcard', scope:{text,description,name},
   *        labelIds:[], pinnedFirst, limit, offset}
   */
  list(opts = {}) {
    const { query = '', mode = 'contains', labelIds = [], limit = 200, offset = 0, caseInsensitive = true } = opts;
    const scope = { text: true, description: false, name: true, ...(opts.scope || {}) };
    const where = [];
    const params = [];
    const q = query.trim();
    if (q) {
      const cols = [];
      if (scope.text) cols.push('c.search_text');
      if (scope.description) cols.push('c.preview');
      if (scope.name) cols.push("COALESCE(c.quick_name,'')");
      if (!cols.length) cols.push('c.search_text');
      if (mode === 'regex') {
        this._rx = makeRegexp(q, caseInsensitive);
        if (!this._rx) return { rows: [], total: 0, error: 'Espressione non valida' };
        where.push('(' + cols.map((c) => `crisp_rx(${c})`).join(' OR ') + ')');
      } else {
        const like = mode === 'wildcard' ? wildcardToLike(q.toLowerCase()) : '%' + escapeLike(q.toLowerCase()) + '%';
        where.push('(' + cols.map((c) => `lower(${c}) LIKE ? ESCAPE '\\'`).join(' OR ') + ')');
        for (let i = 0; i < cols.length; i++) params.push(like);
      }
    }
    if (labelIds.length) {
      where.push(`c.id IN (SELECT clip_id FROM clip_labels WHERE label_id IN (${labelIds.map(() => '?').join(',')}))`);
      params.push(...labelIds);
    }
    const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const rows = this.db.prepare(
      `SELECT ${LIST_COLUMNS} FROM clips c ${w} ORDER BY c.pinned DESC, c.pin_order DESC, c.sort_order DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM clips c ${w}`).get(...params).n;
    const lm = this.labelsFor(rows.map((r) => r.id));
    for (const r of rows) r.labels = lm.get(r.id) || [];
    return { rows, total };
  }

  /** Ultime N clip copiate (per le hotkey globali "ultime dieci"). */
  recentIds(n) {
    return this.db.prepare('SELECT id FROM clips ORDER BY sort_order DESC LIMIT ?').all(n).map((r) => r.id);
  }

  /** Clip con nome rapido (Named Paste). */
  findByQuickName(name) {
    const r = this.db.prepare('SELECT id FROM clips WHERE quick_name=? COLLATE NOCASE LIMIT 1').get(name);
    return r ? r.id : null;
  }

  getClip(id) {
    const c = this.db.prepare(`SELECT ${LIST_COLUMNS}, c.source_url FROM clips c WHERE c.id=?`).get(id);
    if (!c) return null;
    c.labels = this.labelsFor([id]).get(id) || [];
    c.formats = this.db.prepare('SELECT format, length(data) AS size FROM formats WHERE clip_id=?').all(id);
    return c;
  }

  getFormat(clipId, format) {
    const r = this.db.prepare('SELECT data FROM formats WHERE clip_id=? AND format=?').get(clipId, format);
    return r ? Buffer.from(r.data) : null;
  }

  getFormats(clipId) {
    return this.db.prepare('SELECT format, data FROM formats WHERE clip_id=?').all(clipId)
      .map((r) => ({ format: r.format, data: Buffer.from(r.data) }));
  }

  getText(clipId) {
    const b = this.getFormat(clipId, 'text');
    return b ? b.toString('utf8') : null;
  }

  // ---- modifica ----
  /** Modifica in-place del testo: sostituisce text, scarta html/rtf ormai obsoleti. */
  updateText(id, text, { previewChars = 500 } = {}) {
    const db = this.db;
    const buf = Buffer.from(text, 'utf8');
    db.exec('BEGIN');
    try {
      db.prepare("DELETE FROM formats WHERE clip_id=? AND format IN ('text','html','rtf')").run(id);
      db.prepare('INSERT INTO formats(clip_id,format,data) VALUES(?,?,?)').run(id, 'text', buf);
      db.prepare('UPDATE clips SET preview=?, search_text=?, hash=?, size=?, edited=1 WHERE id=?').run(
        text.replace(/\s+/g, ' ').trim().slice(0, previewChars),
        text.toLowerCase().slice(0, 200000),
        Store.hashOf(['text', buf]),
        buf.length, id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  setMeta(id, meta) {
    const allowed = { quick_name: 'quick_name', never_delete: 'never_delete', hotkey: 'hotkey' };
    for (const [k, col] of Object.entries(allowed)) {
      if (k in meta) this.db.prepare(`UPDATE clips SET ${col}=? WHERE id=?`).run(meta[k] ?? null, id);
    }
  }

  markUsed(id, { reorder }) {
    const now = Date.now();
    this.db.prepare('UPDATE clips SET last_used_at=?, use_count=use_count+1 WHERE id=?').run(now, id);
    if (reorder) this.bump(id);
  }

  setPinned(id, pinned) {
    if (pinned) {
      const max = this.db.prepare('SELECT COALESCE(MAX(pin_order),0) AS m FROM clips WHERE pinned=1').get().m;
      this.db.prepare('UPDATE clips SET pinned=1, pin_order=?, never_delete=1 WHERE id=?').run(max + 1, id);
    } else {
      this.db.prepare('UPDATE clips SET pinned=0, pin_order=0 WHERE id=?').run(id);
    }
  }

  /** Sposta una clip nell'ordine della sua sezione (pin oppure recenti). */
  move(id, where) {
    const c = this.db.prepare('SELECT pinned FROM clips WHERE id=?').get(id);
    if (!c) return;
    const col = c.pinned ? 'pin_order' : 'sort_order';
    const sect = 'pinned=' + (c.pinned ? 1 : 0);
    const cur = this.db.prepare(`SELECT ${col} AS v FROM clips WHERE id=?`).get(id).v;
    const one = (sql, ...p) => this.db.prepare(sql).get(...p);
    let val = null;
    if (where === 'top') val = one(`SELECT MAX(${col}) AS v FROM clips WHERE ${sect}`).v + 1;
    else if (where === 'bottom') val = one(`SELECT MIN(${col}) AS v FROM clips WHERE ${sect}`).v - 1;
    else if (where === 'up') {
      const a = one(`SELECT ${col} AS v FROM clips WHERE ${sect} AND ${col}>? ORDER BY ${col} ASC LIMIT 1`, cur);
      const b = a && one(`SELECT ${col} AS v FROM clips WHERE ${sect} AND ${col}>? ORDER BY ${col} ASC LIMIT 1`, a.v);
      if (a) val = b ? (a.v + b.v) / 2 : a.v + 1;
    } else if (where === 'down') {
      const a = one(`SELECT ${col} AS v FROM clips WHERE ${sect} AND ${col}<? ORDER BY ${col} DESC LIMIT 1`, cur);
      const b = a && one(`SELECT ${col} AS v FROM clips WHERE ${sect} AND ${col}<? ORDER BY ${col} DESC LIMIT 1`, a.v);
      if (a) val = b ? (a.v + b.v) / 2 : a.v - 1;
    }
    if (val != null) this.db.prepare(`UPDATE clips SET ${col}=? WHERE id=?`).run(val, id);
  }

  delete(ids) {
    if (!ids.length) return 0;
    const r = this.db.prepare(`DELETE FROM clips WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
    return Number(r.changes);
  }

  // ---- etichette ----
  listLabels() {
    return this.db.prepare(`SELECT l.id, l.name, l.color, l.position,
      (SELECT COUNT(*) FROM clip_labels cl WHERE cl.label_id=l.id) AS count
      FROM labels l ORDER BY l.position`).all();
  }

  createLabel(name, color) {
    const pos = this.db.prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM labels').get().p;
    const r = this.db.prepare('INSERT INTO labels(name,color,position) VALUES(?,?,?)').run(name.trim(), color, pos);
    return Number(r.lastInsertRowid);
  }

  updateLabel(id, { name, color }) {
    if (name != null) this.db.prepare('UPDATE labels SET name=? WHERE id=?').run(name.trim(), id);
    if (color != null) this.db.prepare('UPDATE labels SET color=? WHERE id=?').run(color, id);
  }

  deleteLabel(id) { this.db.prepare('DELETE FROM labels WHERE id=?').run(id); }

  /** mode: 'add' | 'remove' | 'toggle' | 'set' */
  assignLabel(clipIds, labelIds, mode = 'toggle') {
    const has = this.db.prepare('SELECT 1 FROM clip_labels WHERE clip_id=? AND label_id=?');
    const add = this.db.prepare('INSERT OR IGNORE INTO clip_labels(clip_id,label_id) VALUES(?,?)');
    const del = this.db.prepare('DELETE FROM clip_labels WHERE clip_id=? AND label_id=?');
    this.db.exec('BEGIN');
    try {
      for (const c of clipIds) {
        if (mode === 'set') this.db.prepare('DELETE FROM clip_labels WHERE clip_id=?').run(c);
        for (const l of labelIds) {
          if (mode === 'add' || mode === 'set') add.run(c, l);
          else if (mode === 'remove') del.run(c, l);
          else if (has.get(c, l)) del.run(c, l); else add.run(c, l);
        }
      }
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---- retention (i pin e i "mai eliminare" non vengono mai toccati) ----
  applyRetention({ maxEntries = 0, expireDays = 0 } = {}) {
    let removed = 0;
    if (expireDays > 0) {
      const cutoff = Date.now() - expireDays * 86400000;
      removed += Number(this.db.prepare(
        'DELETE FROM clips WHERE pinned=0 AND never_delete=0 AND COALESCE(last_used_at,created_at) < ?').run(cutoff).changes);
    }
    if (maxEntries > 0) {
      const over = this.db.prepare('SELECT COUNT(*) AS n FROM clips WHERE pinned=0 AND never_delete=0').get().n - maxEntries;
      if (over > 0) {
        removed += Number(this.db.prepare(`DELETE FROM clips WHERE id IN (
          SELECT id FROM clips WHERE pinned=0 AND never_delete=0 ORDER BY sort_order ASC LIMIT ?)`).run(over).changes);
      }
    }
    return removed;
  }

  deleteUnused() {
    return Number(this.db.prepare(
      "DELETE FROM clips WHERE pinned=0 AND never_delete=0 AND use_count=0 AND id NOT IN (SELECT clip_id FROM clip_labels)").run().changes);
  }

  deleteAll({ keepPinned = true } = {}) {
    return Number(this.db.prepare(keepPinned ? 'DELETE FROM clips WHERE pinned=0' : 'DELETE FROM clips').run().changes);
  }

  // ---- manutenzione ----
  stats() {
    const one = (sql) => this.db.prepare(sql).get();
    const bytes = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
    return {
      clips: one('SELECT COUNT(*) AS n FROM clips').n,
      pinned: one('SELECT COUNT(*) AS n FROM clips WHERE pinned=1').n,
      labels: one('SELECT COUNT(*) AS n FROM labels').n,
      pastes: one('SELECT COALESCE(SUM(use_count),0) AS n FROM clips').n,
      dataBytes: one('SELECT COALESCE(SUM(length(data)),0) AS n FROM formats').n,
      fileBytes: bytes,
    };
  }

  compact() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;'); }

  backupTo(file) {
    if (fs.existsSync(file)) fs.rmSync(file);
    this.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }
}

module.exports = { Store };
