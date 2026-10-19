'use strict';
// Cifratura dei messaggi di sincronizzazione (senza dipendenze da Electron, testabile da Node).
const crypto = require('node:crypto');

function encrypt(password, plain) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(password, salt, 32);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return JSON.stringify({ v: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') });
}

function decrypt(password, text) {
  const m = JSON.parse(text);
  if (m.v !== 1) throw new Error('versione non supportata');
  const key = crypto.scryptSync(password, Buffer.from(m.salt, 'base64'), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(m.iv, 'base64'));
  d.setAuthTag(Buffer.from(m.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(m.data, 'base64')), d.final()]).toString('utf8');
}

function frame(text) {
  const body = Buffer.from(text, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  return Buffer.concat([head, body]);
}

module.exports = { encrypt, decrypt, frame };
