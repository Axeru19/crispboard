// Genera gli screenshot per README in docs/img con dati dimostrativi.
// uso: node scripts/screenshots.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'img');
fs.mkdirSync(outDir, { recursive: true });
const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let port = 9555;

class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); this.pending.get(d.id)?.(d); }; }
  static async open(url) { const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; }); return new Page(ws); }
  send(method, params = {}) { const id = ++this.id; return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); }); }
  eval(expr) { return this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); }
  async key(key, { ctrl, alt } = {}) {
    const mods = (alt ? 1 : 0) | (ctrl ? 2 : 0);
    const vk = key.toUpperCase().charCodeAt(0);
    const base = { modifiers: mods, key, code: 'Key' + key.toUpperCase(), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(path.join(outDir, file), Buffer.from(r.result.data, 'base64'));
    console.log('scritto', file);
  }
}

async function run(theme) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crisp-shot-'));
  spawnSync('node', [path.join(root, 'scripts', 'seed-demo.js'), dataDir, theme], { stdio: 'ignore' });
  const p = port++;
  const app = spawn(electron, [root, `--remote-debugging-port=${p}`, '--show'], { env: { ...process.env, CRISPBOARD_DATA_DIR: dataDir }, stdio: 'ignore' });
  try {
    let targets;
    for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${p}/json`)).json(); break; } catch { await sleep(200); } }
    const popup = await Page.open(targets.find((t) => t.url.includes('index.html')).webSocketDebuggerUrl);
    await popup.send('Page.enable');
    await sleep(1500);
    await popup.eval(`document.querySelector('#q').focus(); document.querySelector('#list').scrollTop = 0`);
    await sleep(300);
    await popup.shot(`popup-${theme}.png`);

    if (theme === 'dark') {
      // editor in-place
      await popup.eval(`document.querySelectorAll('.row')[3].click()`);
      await sleep(300);
      await popup.key('e', { ctrl: true });
      await sleep(400);
      await popup.shot('edit-dark.png');
      await popup.key('Escape');
      await sleep(200);
      // filtro etichetta
      await popup.eval(`document.querySelector('.labelbar .chip[data-id]').click()`);
      await sleep(400);
      await popup.shot('labels-dark.png');
      await popup.eval(`document.querySelector('.labelbar .chip[data-id]').click()`);
      await sleep(300);
      // impostazioni
      await popup.eval(`window.crisp.invoke('window:settings')`);
      await sleep(1500);
      const t2 = await (await fetch(`http://127.0.0.1:${p}/json`)).json();
      const st = t2.find((t) => t.url.includes('settings.html'));
      if (st) {
        const sp = await Page.open(st.webSocketDebuggerUrl);
        await sp.send('Page.enable');
        await sp.eval(`document.querySelector('#side [data-id="labels"]').click()`);
        await sleep(500);
        await sp.shot('settings-labels-dark.png');
      }
    }
  } finally {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' });
    await sleep(500);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

await run('dark');
await run('light');
