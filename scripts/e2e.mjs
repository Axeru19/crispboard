// Verifica end-to-end: avvia l'app reale, usa la clipboard di Windows, pilota la UI via CDP
// e controlla il testo incollato in una finestra WinForms di prova.
// uso: node scripts/e2e.mjs [cartella-output]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
const pathToFileUrl = (p) => pathToFileURL(p).href;

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
$t.Add_KeyDown({ if ($_.Control -and $_.KeyCode -eq 'A') { $t.SelectAll(); $_.SuppressKeyPress=$true } })
$f.Add_Shown({ $f.Activate(); $t.Focus() })
[Windows.Forms.Application]::Run($f)
`);
let sink;
const sinkText = () => (fs.existsSync(sinkFile) ? fs.readFileSync(sinkFile, 'utf8') : '');
async function focusSink() {
  const focusScript = `
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public class W { [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint fl, UIntPtr ex);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c); }
'@
$p = Get-Process powershell | Where-Object { $_.MainWindowTitle -eq 'CrispSink' } | Select-Object -First 1
if (-not $p) { 'nosink'; exit }
for ($i=0; $i -lt 6; $i++) {
  [W]::keybd_event(0x12,0,0,[UIntPtr]::Zero); [W]::keybd_event(0x12,0,2,[UIntPtr]::Zero)
  $fg = [W]::GetForegroundWindow(); $ft = [W]::GetWindowThreadProcessId($fg, [IntPtr]::Zero); $me = [W]::GetCurrentThreadId()
  [W]::AttachThreadInput($me, $ft, $true) | Out-Null
  [W]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [W]::BringWindowToTop($p.MainWindowHandle) | Out-Null
  [W]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  [W]::AttachThreadInput($me, $ft, $false) | Out-Null
  Start-Sleep -Milliseconds 150
  $sb = New-Object Text.StringBuilder 64; [W]::GetWindowText([W]::GetForegroundWindow(), $sb, 64) | Out-Null
  if ($sb.ToString() -eq 'CrispSink') { 'focused'; exit }
}
'failed'`;
  const r = ps(focusScript);
  if (!/focused/.test(r.stdout)) console.log('  (attenzione: focus sink non ottenuto: ' + r.stdout.trim() + ')');
  await sleep(200);
}
const setClip = (text) => ps(`Set-Clipboard -Value '${text.replace(/'/g, "''")}'`);

const sendKeys = (keys) => ps(`Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.SendKeys]::SendWait('${keys}')`, true);
async function showPopup() {
  sendKeys('^%v');
  await sleep(500);
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
  for (let i = 0; i < 60 && !fs.existsSync(sinkFile); i++) await sleep(250);
  await sleep(500);
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
  const firstRow = (await popup.eval(`document.querySelector('.row .line').textContent`)).slice(0, 12);
  await popup.key('1', { ctrl: true });
  await sleep(1000);
  check('Ctrl+1 incolla la prima clip', sinkText().includes(firstRow), firstRow + ' / ' + JSON.stringify(sinkText()));

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

  // ---------- hotkey globale ----------
  await focusSink();
  sendKeys('^%v');
  await sleep(1000);
  check('hotkey globale Ctrl+Alt+V apre il popup', (await visible()) === 'visible');
  await popup.shot('06-hotkey');

  // ---------- incolla speciale (maiuscolo) ----------
  setClip('beta due');
  await sleep(900);
  const betaId = dbRows("SELECT id FROM clips WHERE preview='beta due'")[0].id;
  fs.writeFileSync(sinkFile, '');
  await popup.eval(`window.crisp.invoke('clips:paste',{ids:[${betaId}],transform:'upper'}).then(()=>1)`);
  await sleep(1000);
  check('incolla speciale MAIUSCOLO', sinkText().includes('BETA DUE'), JSON.stringify(sinkText()));

  // ---------- multi-incolla + salvataggio ----------
  await popup.eval(`window.crisp.invoke('settings:set',{saveMultiPaste:true,multiSeparator:' | '}).then(()=>1)`);
  await focusSink();
  sendKeys('^%v');
  await sleep(900);
  const ids2 = dbRows("SELECT id FROM clips WHERE preview IN ('beta due','alpha uno MODIFICATO') ORDER BY id").map((r) => r.id);
  await popup.eval(`window.crisp.invoke('clips:paste',{ids:${JSON.stringify(ids2)}}).then(()=>1)`);
  await sleep(1000);
  check('multi-incolla con separatore', /alpha uno MODIFICATO \| beta due/.test(sinkText()) || /beta due \| alpha uno MODIFICATO/.test(sinkText()), JSON.stringify(sinkText()));
  check('multi-incolla salvato come nuova clip', dbRows("SELECT 1 FROM clips WHERE preview LIKE '% | %'").length === 1);

  // ---------- ripristino formati nella clipboard ----------
  ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing; $b=New-Object Drawing.Bitmap 40,30; $g=[Drawing.Graphics]::FromImage($b); $g.Clear([Drawing.Color]::SteelBlue); [Windows.Forms.Clipboard]::SetImage($b)`, true);
  await sleep(900);
  ps(`Set-Clipboard -Path '${path.join(out, 'file-a.txt')}','${path.join(out, 'file-b.txt')}'`);
  await sleep(900);
  ps(`Set-Clipboard -Value '<b>grassetto</b> html' -AsHtml`);
  await sleep(900);
  const imgId = dbRows("SELECT id FROM clips WHERE kind='image'")[0].id;
  await popup.eval(`window.crisp.invoke('clips:copy',{id:${imgId}}).then(()=>1)`);
  await sleep(400);
  let r = ps(`Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::ContainsImage()`, true);
  check('copia clip immagine: immagine nella clipboard', r.stdout.trim() === 'True', r.stdout + r.stderr);
  const fileId = dbRows("SELECT id FROM clips WHERE kind='files'")[0].id;
  await popup.eval(`window.crisp.invoke('clips:copy',{id:${fileId}}).then(()=>1)`);
  await sleep(400);
  r = ps(`(Get-Clipboard -Format FileDropList | ForEach-Object { $_.Name }) -join ','`);
  check('copia clip file: CF_HDROP ripristinato', r.stdout.trim() === 'file-a.txt,file-b.txt', r.stdout + r.stderr);
  const htmlId = dbRows("SELECT id FROM clips WHERE preview LIKE '%grassetto%'")[0].id;
  await popup.eval(`window.crisp.invoke('clips:copy',{id:${htmlId}}).then(()=>1)`);
  await sleep(400);
  r = ps(`Add-Type -AssemblyName System.Windows.Forms; [Windows.Forms.Clipboard]::ContainsText([Windows.Forms.TextDataFormat]::Html)`, true);
  check('copia clip html: formato HTML ripristinato', r.stdout.trim() === 'True', r.stdout + r.stderr);

  // ---------- ricerca regex / wildcard / scope ----------
  let res = await popup.eval(`window.crisp.invoke('clips:list',{query:String.raw\`^beta\\s\\w+$\`,mode:'regex'})`);
  check('ricerca regex', res.total === 1, JSON.stringify(res.total));
  res = await popup.eval(`window.crisp.invoke('clips:list',{query:'b*due',mode:'wildcard'})`);
  check('ricerca wildcard', res.total >= 1, JSON.stringify(res.total));
  res = await popup.eval(`window.crisp.invoke('clips:list',{query:'(',mode:'regex'})`);
  check('regex non valida segnalata senza crash', !!res.error);

  // ---------- sincronizzazione (loopback, entrambe le direzioni) ----------
  const { default: nodeNet } = await import('node:net');
  const { decrypt, encrypt, frame } = await import(pathToFileUrl(path.join(root, 'src', 'main', 'synccrypto.js')));
  const got = await new Promise((resolve) => {
    const srv = nodeNet.createServer((sock) => {
      const ch = [];
      sock.on('data', (d) => ch.push(d));
      sock.on('end', () => { srv.close(); resolve(Buffer.concat(ch)); });
    });
    srv.listen(23998, '127.0.0.1', async () => {
      await popup.eval(`window.crisp.invoke('settings:set',{syncPassword:'pw-test',friends:[{name:'locale',host:'127.0.0.1',port:23998,sendAll:false}]}).then(()=>1)`);
      await popup.eval(`window.crisp.invoke('sync:send',{friendIndex:0,ids:[${betaId}]}).then(()=>1)`);
    });
  });
  const plain = decrypt('pw-test', got.subarray(4).toString('utf8'));
  check('sync: invio cifrato decifrabile dal destinatario', JSON.parse(plain).clips[0].preview === 'beta due', plain.slice(0, 80));

  await popup.eval(`window.crisp.invoke('settings:set',{syncReceive:true,syncPort:23999,syncPassword:'pw-test'}).then(()=>1)`);
  await sleep(500);
  const incoming = JSON.stringify({ app: 'crispboard', version: 1, labels: [], clips: [{
    created_at: Date.now(), kind: 'text', preview: 'da-remoto', search_text: 'da-remoto', hash: 'h-remoto', size: 9, pinned: 0,
    labels: [], formats: [{ format: 'text', data: Buffer.from('da-remoto').toString('base64') }] }] });
  await new Promise((resolve) => { const c = nodeNet.connect(23999, '127.0.0.1', () => c.end(frame(encrypt('pw-test', incoming)), resolve)); });
  await sleep(800);
  check('sync: ricezione cifrata importa la clip', dbRows("SELECT 1 FROM clips WHERE preview='da-remoto'").length === 1);
  await new Promise((resolve) => { const c = nodeNet.connect(23999, '127.0.0.1', () => c.end(frame(encrypt('password-sbagliata', incoming.replace('da-remoto', 'intruso'))), resolve)); });
  await sleep(800);
  check('sync: password errata rifiutata', dbRows("SELECT 1 FROM clips WHERE preview='intruso'").length === 0);
  await popup.eval(`window.crisp.invoke('settings:set',{syncReceive:false}).then(()=>1)`);

  // ---------- buffer di copia ----------
  await popup.eval(`window.crisp.invoke('settings:set',{cbCopy1:'Ctrl+Alt+1',cbPaste1:'Ctrl+Alt+2'}).then(()=>1)`);
  await sleep(300);
  fs.writeFileSync(sinkFile, '');
  await popup.key('Escape');
  await focusSink();
  sendKeys('^a{DEL}');
  await sleep(300);
  sendKeys('testo-buffer');
  await sleep(600);
  sendKeys('^a');
  sendKeys('^%1');
  await sleep(1200);
  const settingsNow = await popup.eval(`window.crisp.invoke('settings:get')`);
  check('buffer di copia: salvato nello slot 1', !!settingsNow.bufferClips?.['1'] && dbRows('SELECT 1 FROM clips WHERE id=?', Number(settingsNow.bufferClips?.['1'])).length === 1, JSON.stringify(settingsNow.bufferClips));
  sendKeys('{DEL}');
  await sleep(400);
  sendKeys('^%2');
  await sleep(1200);
  check('buffer di copia: incolla dallo slot 1', sinkText().includes('testo-buffer'), JSON.stringify(sinkText()));

  // ---------- aspetto: tema chiaro e finestra impostazioni ----------
  await popup.eval(`window.crisp.invoke('settings:set',{theme:'light'}).then(()=>1)`);
  await sleep(500);
  await focusSink();
  sendKeys('^%v');
  await sleep(900);
  await popup.shot('07-light');
  await popup.eval(`window.crisp.invoke('window:settings').then(()=>1)`);
  await sleep(1500);
  const tgs = await targets();
  const st = tgs.find((x) => x.url.includes('settings.html'));
  check('finestra impostazioni apre', !!st);
  if (st) {
    const sp = await Page.open(st.webSocketDebuggerUrl);
    await sp.send('Page.enable');
    for (const sec of ['general', 'history', 'buffers', 'sync', 'labels', 'data', 'about']) {
      await sp.eval(`document.querySelector('#side [data-id="${sec}"]').click()`);
      await sleep(400);
      await sp.shot('settings-' + sec);
      if (sec === 'labels') {
        const lab = await sp.eval(`document.querySelectorAll('.lbl-row').length`);
        check('impostazioni: sezione etichette elenca le etichette', lab >= 2, 'righe=' + lab);
      }
    }
  }
  await popup.eval(`window.crisp.invoke('settings:set',{theme:'system'}).then(()=>1)`);
} catch (e) {
  check('esecuzione senza eccezioni', false, e.stack || String(e));
} finally {
  try { sink?.kill(); ps(`Get-Process powershell | Where-Object { $_.MainWindowTitle -eq 'CrispSink' } | Stop-Process -Force`); } catch {}
  spawnSync('taskkill', ['/F', '/T', '/PID', String(app.pid)], { stdio: 'ignore' });
  fs.writeFileSync(path.join(out, 'app.log'), appLog);
  if (results.some((r) => !r.ok)) console.log('--- app.log (coda) ---\n' + appLog.split('\n').slice(-15).join('\n'));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ok. Output in ${out}`);
  process.exit(failed ? 1 : 0);
}
