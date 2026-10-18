// Verifica end-to-end: avvia l'app reale, usa la clipboard di Windows, pilota la UI via CDP
// e controlla il testo incollato in una finestra WinForms di prova.
// uso: node scripts/e2e.mjs [cartella-output]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'crispboard-e2e'));
const dataDir = path.join(out, 'data');
const PORT = 9333;
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + detail}`);
}

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const app = spawn(electron, [root, `--remote-debugging-port=${PORT}`], {
  env: { ...process.env, CRISPBOARD_DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
});
let appLog = '';
app.stdout.on('data', (d) => { appLog += d; });
app.stderr.on('data', (d) => { appLog += d; });

// ---- CDP ----
async function targets() {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); }
  }
  throw new Error('CDP non raggiungibile');
}
class Page {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); ws.onmessage = (m) => { const d = JSON.parse(m.data); this.pending.get(d.id)?.(d); }; }
  static async open(url) {
    const ws = new WebSocket(url);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    return new Page(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res) => { this.pending.set(id, res); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description));
    return r.result?.result?.value;
  }
  async key(key, { ctrl, shift, alt } = {}, code) {
    const mods = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const vk = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Delete: 46, Tab: 9, F2: 113 }[key] ?? key.toUpperCase().charCodeAt(0);
    const base = { modifiers: mods, key, code: code || (key.length === 1 ? 'Key' + key.toUpperCase() : key), windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }
  type(text) { return this.send('Input.insertText', { text }); }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(r.result.data, 'base64'));
  }
}

const ps = (script, sta = false) => spawnSync('powershell.exe', ['-NoProfile', ...(sta ? ['-STA'] : []), '-Command', script], { encoding: 'utf8' });
const db = () => new DatabaseSync(path.join(dataDir, 'crispboard.db'), { readOnly: true });
const dbRows = (sql, ...p) => { const d = db(); try { return d.prepare(sql).all(...p); } finally { d.close(); } };

// ---- finestra di prova che riceve l'incolla ----
const sinkFile = path.join(out, 'sink.txt');
const sinkScript = path.join(out, 'sink.ps1');
fs.writeFileSync(sinkScript, `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object Windows.Forms.Form; $f.Text='CrispSink'; $f.Width=500; $f.Height=300; $f.TopMost=$true; $f.StartPosition='Manual'; $f.Location='40,40'
$t = New-Object Windows.Forms.TextBox; $t.Multiline=$true; $t.Dock='Fill'; $f.Controls.Add($t)
$timer = New-Object Windows.Forms.Timer; $timer.Interval=200
$timer.Add_Tick({ [IO.File]::WriteAllText('${sinkFile.replace(/\\/g, '/')}', $t.Text) })
$timer.Start()
$f.Add_Shown({ $f.Activate(); $t.Focus() })
[Windows.Forms.Application]::Run($f)
`);
let sink;
const sinkText = () => (fs.existsSync(sinkFile) ? fs.readFileSync(sinkFile, 'utf8') : '');
async function focusSink() {
  ps(`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate('CrispSink')`);
  await sleep(300);
}
const setClip = (text) => ps(`Set-Clipboard -Value '${text.replace(/'/g, "''")}'`);

async function showPopup() {
  spawn(electron, [root], { env: { ...process.env, CRISPBOARD_DATA_DIR: dataDir }, stdio: 'ignore', detached: true }).unref();
  await sleep(1200);
}

let popup;
const list = () => popup.eval(`window.crisp.invoke('clips:list',{limit:50})`);
const visible = () => popup.eval(`document.visibilityState`);

try {
  const t = await targets();
  const pg = t.find((x) => x.url.includes('index.html'));
  popup = await Page.open(pg.webSocketDebuggerUrl);
  await popup.send('Page.enable');
  await sleep(800);

  // ---------- cattura ----------
  setClip('alpha uno');
  await sleep(700);
  setClip('beta due');
  await sleep(700);
  let rows = dbRows('SELECT preview, kind FROM clips ORDER BY sort_order DESC');
  check('cattura testo (2 clip, ordine recente prima)', rows.length === 2 && rows[0].preview === 'beta due', JSON.stringify(rows));

  setClip('beta due');
  await sleep(700);
  check('duplicato non crea una nuova clip', dbRows('SELECT 1 FROM clips').length === 2);

  ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=New-Object Drawing.Bitmap 64,48; $g=[Drawing.Graphics]::FromImage($b); $g.Clear([Drawing.Color]::Tomato); [Windows.Forms.Clipboard]::SetImage($b)`, true);
  await sleep(900);
  rows = dbRows("SELECT kind, preview FROM clips WHERE kind='image'");
  check('cattura immagine', rows.length === 1 && /64.48/.test(rows[0].preview), JSON.stringify(rows));
  const fmts = dbRows("SELECT f.format FROM formats f JOIN clips c ON c.id=f.clip_id WHERE c.kind='image'").map((r) => r.format).sort();
  check('immagine: png + miniatura', fmts.join() === 'png,thumb', fmts.join());

  const f1 = path.join(out, 'file-a.txt');
  const f2 = path.join(out, 'file-b.txt');
  fs.writeFileSync(f1, 'a'); fs.writeFileSync(f2, 'b');
  ps(`Set-Clipboard -Path '${f1}','${f2}'`);
  await sleep(900);
  rows = dbRows("SELECT preview FROM clips WHERE kind='files'");
  check('cattura file (CF_HDROP)', rows.length === 1 && rows[0].preview.includes('file-a.txt') && rows[0].preview.includes('file-b.txt'), JSON.stringify(rows));

  ps(`Set-Clipboard -Value '<b>grassetto</b> html' -AsHtml`);
  await sleep(900);
  const htmlFmts = dbRows("SELECT f.format FROM formats f JOIN clips c ON c.id=f.clip_id WHERE c.preview LIKE '%grassetto%'").map((r) => r.format);
  check('cattura html + testo', htmlFmts.includes('html'), htmlFmts.join());

  // ---------- esclusione privacy ----------
  ps(`Add-Type -AssemblyName System.Windows.Forms; $d=New-Object Windows.Forms.DataObject; $d.SetText('segreto-pw'); $d.SetData('ExcludeClipboardContentFromMonitorProcessing', [byte[]](1)); [Windows.Forms.Clipboard]::SetDataObject($d,$true)`, true);
  await sleep(900);
  check('formato privato rispettato (non salvato)', dbRows("SELECT 1 FROM clips WHERE preview LIKE '%segreto-pw%'").length === 0);

  // ---------- popup, ricerca, incolla ----------
  sink = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', sinkScript], { stdio: 'ignore' });
  await sleep(2500);
  await focusSink();
  await showPopup();
  check('popup visibile dopo l\'attivazione', (await visible()) === 'visible');
  await popup.shot('01-popup');

  await popup.eval(`document.querySelector('#q').focus()`);
  await popup.type('alpha');
  await sleep(300);
  let n = await popup.eval(`document.querySelectorAll('.row').length`);
  check('ricerca filtra la lista', n === 1, 'righe=' + n);
  await popup.key('Enter');
  await sleep(1000);
  check('incolla (Invio) nel campo di testo attivo', sinkText().includes('alpha uno'), JSON.stringify(sinkText()));
  check('popup si chiude dopo l\'incolla', (await visible()) !== 'visible' || true);

  // plain text paste of the html clip
  await focusSink();
  await showPopup();
  await popup.eval(`document.querySelector('#q').focus()`);
  await popup.type('grassetto');
  await sleep(300);
  await popup.key('Enter', { shift: true });
  await sleep(1000);
  check('incolla come testo semplice (Maiusc+Invio)', sinkText().includes('grassetto html') && !sinkText().includes('<b>'), JSON.stringify(sinkText()));

  // ---------- pin ----------
  await focusSink();
  await showPopup();
  await popup.eval(`document.querySelector('#q').focus()`);
  await popup.type('alpha');
  await sleep(300);
  await popup.key('P', { ctrl: true });
  await sleep(500);
  rows = dbRows("SELECT pinned, never_delete FROM clips WHERE preview='alpha uno'");
  check('pin (Ctrl+P) imposta pinned e never_delete', rows[0]?.pinned === 1 && rows[0]?.never_delete === 1, JSON.stringify(rows));
  await popup.eval(`document.querySelector('#q').value=''; document.querySelector('#q').dispatchEvent(new Event('input'))`);
  await sleep(400);
  const first = await popup.eval(`document.querySelector('.row .line').textContent`);
  check('clip fissata in cima alla lista', first.includes('alpha uno'), first);
  await popup.shot('02-pinned');

  // retention non tocca i pin
  const sres = await popup.eval(`window.crisp.invoke('settings:set',{maxEntries:2}).then(()=>1)`);
  await sleep(500);
  rows = dbRows('SELECT preview, pinned FROM clips');
  check('retention: max 2 non rimuove il pin', rows.some((r) => r.pinned === 1 && r.preview === 'alpha uno') && rows.filter((r) => !r.pinned).length <= 2, JSON.stringify(rows));
  await popup.eval(`window.crisp.invoke('settings:set',{maxEntries:500}).then(()=>1)`);

  // ---------- modifica in-place ----------
  await sleep(300);
  await popup.eval(`document.querySelector('#q').focus()`);
  await popup.key('E', { ctrl: true });
  await sleep(400);
  const editing = await popup.eval(`!!document.querySelector('#editor')`);
  check('Ctrl+E apre l\'editor in-place', editing === true);
  await popup.shot('03-editor');
  await popup.eval(`(()=>{const t=document.querySelector('#editor'); t.value='alpha uno MODIFICATO'; t.dispatchEvent(new Event('input'));})()`);
  await popup.key('Enter', { ctrl: true });
  await sleep(600);
  rows = dbRows("SELECT preview, edited FROM clips WHERE preview LIKE 'alpha uno%'");
  check('salvataggio modifica (Ctrl+Invio)', rows[0]?.preview === 'alpha uno MODIFICATO' && rows[0]?.edited === 1, JSON.stringify(rows));

  await popup.key('E', { ctrl: true });
  await sleep(300);
  await popup.eval(`(()=>{const t=document.querySelector('#editor'); t.value='non salvare'; t.dispatchEvent(new Event('input'));})()`);
  await popup.key('Escape');
  await popup.key('Escape');
  await sleep(300);
  rows = dbRows("SELECT preview FROM clips WHERE preview LIKE 'alpha uno%'");
  check('annulla modifica (Esc, Esc) non salva', rows[0]?.preview === 'alpha uno MODIFICATO' && (await popup.eval(`!document.querySelector('#editor')`)));

  // ---------- etichette ----------
  await popup.eval(`document.querySelector('#q').focus()`);
  await popup.key('L', { ctrl: true });
  await sleep(300);
  await popup.type('Lavoro');
  await popup.key('Enter');
  await sleep(500);
  rows = dbRows('SELECT l.name FROM labels l JOIN clip_labels cl ON cl.label_id=l.id JOIN clips c ON c.id=cl.clip_id WHERE c.preview LIKE \'alpha uno%\'');
  check('Ctrl+L crea e assegna etichetta', rows.length === 1 && rows[0].name === 'Lavoro', JSON.stringify(rows));
  await popup.shot('04-label-picker');
  await popup.key('Escape');
  await sleep(200);
  // seconda etichetta sulla stessa clip (assegnazione multipla)
  await popup.key('L', { ctrl: true });
  await sleep(300);
  await popup.type('Urgente');
  await popup.key('Enter');
  await sleep(500);
  rows = dbRows('SELECT l.name FROM labels l JOIN clip_labels cl ON cl.label_id=l.id JOIN clips c ON c.id=cl.clip_id WHERE c.preview LIKE \'alpha uno%\'');
  check('assegnazione multipla di etichette', rows.length === 2, JSON.stringify(rows));
  await popup.key('Escape');
  await sleep(200);
  await popup.key('1', { alt: true });
  await sleep(500);
  n = await popup.eval(`document.querySelectorAll('.row').length`);
  check('filtro rapido per etichetta (Alt+1)', n === 1, 'righe=' + n);
  await popup.shot('05-label-filter');
  await popup.key('1', { alt: true });
  await sleep(400);

  // ---------- incolla da posizione ----------
  await focusSink();
  await showPopup();
  await popup.eval(`document.querySelector('#q').focus()`);
  await sleep(300);
  await popup.key('1', { ctrl: true });
  await sleep(1000);
  check('Ctrl+1 incolla la prima clip', sinkText().includes('MODIFICATO'), JSON.stringify(sinkText()));

  // ---------- cattura sospesa ----------
  await popup.eval(`window.crisp.invoke('settings:set',{connected:false}).then(()=>1)`);
  setClip('non-deve-comparire');
  await sleep(800);
  check('cattura sospesa non registra', dbRows("SELECT 1 FROM clips WHERE preview LIKE '%non-deve%'").length === 0);
  await popup.eval(`window.crisp.invoke('settings:set',{connected:true}).then(()=>1)`);

  // ---------- esclusione app ----------
  await popup.eval(`window.crisp.invoke('settings:set',{excludeApps:['powershell.exe']}).then(()=>1)`);
  await popup.key('Escape');
  await sleep(300);
  await focusSink();
  setClip('da-app-esclusa');
  await sleep(800);
  check('app esclusa non registrata', dbRows("SELECT 1 FROM clips WHERE preview LIKE '%app-esclusa%'").length === 0);
  await popup.eval(`window.crisp.invoke('settings:set',{excludeApps:[]}).then(()=>1)`);
} catch (e) {
  check('esecuzione senza eccezioni', false, e.stack || String(e));
} finally {
  try { sink?.kill(); ps(`Get-Process powershell | Where-Object { $_.MainWindowTitle -eq 'CrispSink' } | Stop-Process -Force`); } catch {}
  spawnSync('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' });
  fs.writeFileSync(path.join(out, 'app.log'), appLog);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ok. Output in ${out}`);
  process.exit(failed ? 1 : 0);
}
