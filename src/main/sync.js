'use strict';
// Sincronizzazione tra PC in LAN: invio push di clip, cifrato con AES-256-GCM e password condivisa.
// Frame: 4 byte (lunghezza, big endian) + JSON {v, salt, iv, tag, data} (base64).
const net = require('node:net');
const dns = require('node:dns').promises;
const os = require('node:os');
const { EventEmitter } = require('node:events');
const { exportClips, importClips } = require('./exporter');
const { writeClipToClipboard } = require('./paste');
const { encrypt, decrypt, frame } = require('./synccrypto');

const MAX_FRAME = 64 * 1024 * 1024;
const TIMEOUT_MS = 8000;

class Sync extends EventEmitter {
  constructor({ store, settings, watcher }) {
    super();
    this.store = store;
    this.settings = settings;
    this.watcher = watcher;
    this.server = null;
    this.friendIps = new Map();
  }

  /** Avvia/ferma il server in base alle impostazioni. */
  apply() {
    this.stop();
    const s = this.settings;
    if (!s.get('syncReceive')) return;
    if (!s.get('syncPassword')) { this.emit('error', new Error('Imposta una password per ricevere clip')); return; }
    this.server = net.createServer((sock) => this.onConnection(sock));
    this.server.on('error', (e) => this.emit('error', e));
    this.server.listen(Number(s.get('syncPort')), '0.0.0.0');
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  async resolveFriendIps() {
    this.friendIps.clear();
    for (const f of this.settings.get('friends')) {
      try {
        const r = await dns.lookup(f.host, { all: true });
        for (const a of r) this.friendIps.set(a.address.replace(/^::ffff:/, ''), f.name || f.host);
      } catch { /* host non risolvibile */ }
    }
  }

  onConnection(sock) {
    const chunks = [];
    let total = 0;
    let need = -1;
    sock.setTimeout(TIMEOUT_MS, () => sock.destroy());
    sock.on('error', () => sock.destroy());
    sock.on('data', (d) => {
      chunks.push(d);
      total += d.length;
      if (need < 0 && total >= 4) {
        need = Buffer.concat(chunks).readUInt32BE(0);
        if (need > MAX_FRAME) sock.destroy();
      }
      if (need >= 0 && total >= need + 4) {
        const all = Buffer.concat(chunks);
        sock.end();
        this.onFrame(all.subarray(4, 4 + need).toString('utf8'), sock.remoteAddress);
      }
    });
  }

  async onFrame(text, remote) {
    let doc;
    try { doc = decrypt(this.settings.get('syncPassword'), text); } catch { this.emit('rejected', remote); return; }
    try {
      const res = importClips(this.store, doc, { bump: true });
      this.emit('received', { remote, ...res });
      if (!res.ids.length) return;
      const ip = String(remote || '').replace(/^::ffff:/, '');
      await this.resolveFriendIps();
      if (this.settings.get('syncAcceptToClipboard') && this.friendIps.has(ip)) {
        writeClipToClipboard(this.store, res.ids[res.ids.length - 1], {});
        this.watcher.markSelfWrite();
      }
    } catch (e) { this.emit('error', e); }
  }

  /** Invia le clip a un amico. Risolve con true oppure rifiuta con l'errore di rete. */
  send(friend, ids) {
    const password = this.settings.get('syncPassword');
    if (!password) return Promise.reject(new Error('Imposta prima la password condivisa'));
    const payload = encrypt(password, exportClips(this.store, ids).replace(/^\{/, `{"from":${JSON.stringify(os.hostname())},`));
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: friend.host, port: Number(friend.port) || 23443 });
      sock.setTimeout(TIMEOUT_MS, () => { sock.destroy(new Error('timeout')); });
      sock.once('error', reject);
      sock.once('connect', () => sock.end(frame(payload), () => resolve(true)));
    });
  }

  sendToAll(ids) {
    const targets = this.settings.get('friends').filter((f) => f.sendAll);
    return Promise.allSettled(targets.map((f) => this.send(f, ids)));
  }
}

module.exports = { Sync };
