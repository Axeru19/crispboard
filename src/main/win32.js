'use strict';
// Win32 via koffi (prebuilt FFI, nessun compilatore richiesto).
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const RECT = koffi.struct('RECT', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });
const POINT = koffi.struct('POINT', { x: 'int32', y: 'int32' });
const GUITHREADINFO = koffi.struct('GUITHREADINFO', {
  cbSize: 'uint32', flags: 'uint32',
  hwndActive: 'void *', hwndFocus: 'void *', hwndCapture: 'void *',
  hwndMenuOwner: 'void *', hwndMoveSize: 'void *', hwndCaret: 'void *',
  rcCaret: RECT,
});
// INPUT su x64: type@0, union@8, size 40. Il membro tastiera occupa 24 byte dell'unione (32 con mouse).
const KBINPUT = koffi.struct('KBINPUT', {
  type: 'uint32', _p0: 'uint32',
  wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32',
  dwExtraInfo: 'uintptr_t', _tail: koffi.array('uint8', 8),
});

const GetClipboardSequenceNumber = user32.func('uint32_t GetClipboardSequenceNumber()');
const GetClipboardOwner = user32.func('void * GetClipboardOwner()');
const GetForegroundWindow = user32.func('void * GetForegroundWindow()');
const SetForegroundWindow = user32.func('bool SetForegroundWindow(void *)');
const GetWindowThreadProcessId = user32.func('uint32_t GetWindowThreadProcessId(void *, _Out_ uint32_t *)');
const GetGUIThreadInfo = user32.func('bool GetGUIThreadInfo(uint32_t, _Inout_ GUITHREADINFO *)');
const ClientToScreen = user32.func('bool ClientToScreen(void *, _Inout_ POINT *)');
const SendInputRaw = user32.func('uint32_t SendInput(uint32_t, KBINPUT *, int)');
const GetAsyncKeyState = user32.func('int16_t GetAsyncKeyState(int)');
const IsIconic = user32.func('bool IsIconic(void *)');
const ShowWindow = user32.func('bool ShowWindow(void *, int)');
const GetWindowTextW = user32.func('int GetWindowTextW(void *, _Out_ uint16_t *, int)');
const IsWindow = user32.func('bool IsWindow(void *)');
const OpenProcess = kernel32.func('void * OpenProcess(uint32_t, bool, uint32_t)');
const CloseHandle = kernel32.func('bool CloseHandle(void *)');
const QueryFullProcessImageNameW = kernel32.func('bool QueryFullProcessImageNameW(void *, uint32_t, _Out_ uint16_t *, _Inout_ uint32_t *)');

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const KEYEVENTF_KEYUP = 0x0002;
const VK = { CONTROL: 0x11, SHIFT: 0x10, MENU: 0x12, V: 0x56, INSERT: 0x2d, LWIN: 0x5b, RWIN: 0x5c };

function sequenceNumber() { return GetClipboardSequenceNumber(); }

function foregroundWindow() { return GetForegroundWindow(); }
function windowAlive(hwnd) { return !!hwnd && IsWindow(hwnd); }

function processExeOfWindow(hwnd) {
  if (!hwnd) return null;
  const pid = [0];
  GetWindowThreadProcessId(hwnd, pid);
  if (!pid[0]) return null;
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
  if (!h) return null;
  try {
    const buf = new Uint16Array(1024);
    const len = [1024];
    if (!QueryFullProcessImageNameW(h, 0, buf, len)) return null;
    return Buffer.from(buf.buffer, 0, len[0] * 2).toString('utf16le');
  } finally { CloseHandle(h); }
}

function windowTitle(hwnd) {
  if (!hwnd) return '';
  const buf = new Uint16Array(512);
  const n = GetWindowTextW(hwnd, buf, 512);
  return n > 0 ? Buffer.from(buf.buffer, 0, n * 2).toString('utf16le') : '';
}

function exeName(fullPath) {
  return fullPath ? fullPath.split(/[\\/]/).pop().toLowerCase() : null;
}

/** App che ha scritto nella clipboard (più affidabile della finestra in primo piano). */
function clipboardSource() {
  const owner = GetClipboardOwner();
  const exe = processExeOfWindow(owner) || processExeOfWindow(GetForegroundWindow());
  const title = windowTitle(owner) || windowTitle(GetForegroundWindow());
  return { exe: exeName(exe), path: exe, title };
}

/** Posizione schermo del caret nella finestra in primo piano, o null. */
function caretScreenPos() {
  const fg = GetForegroundWindow();
  if (!fg) return null;
  const tid = GetWindowThreadProcessId(fg, [0]);
  const info = { cbSize: koffi.sizeof(GUITHREADINFO), rcCaret: {} };
  if (!GetGUIThreadInfo(tid, info) || !info.hwndCaret) return null;
  const pt = { x: info.rcCaret.left, y: info.rcCaret.bottom };
  if (!ClientToScreen(info.hwndCaret, pt)) return null;
  return pt;
}

function key(vk, up) {
  return { type: 1, _p0: 0, wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0, _tail: [0, 0, 0, 0, 0, 0, 0, 0] };
}

function sendKeys(events) {
  const size = koffi.sizeof(KBINPUT);
  SendInputRaw(events.length, events, size);
}

function isDown(vk) { return (GetAsyncKeyState(vk) & 0x8000) !== 0; }

/** Rilascia i modificatori fisicamente premuti, così Ctrl+V non diventa Ctrl+Shift+V ecc. */
function releaseHeldModifiers() {
  const held = [];
  for (const vk of [VK.SHIFT, VK.MENU, VK.LWIN, VK.RWIN]) if (isDown(vk)) held.push(vk);
  if (held.length) sendKeys(held.map((vk) => key(vk, true)));
  return held;
}

function sendPasteKeys(style = 'ctrl+v') {
  releaseHeldModifiers();
  if (style === 'shift+insert') {
    sendKeys([key(VK.SHIFT), key(VK.INSERT), key(VK.INSERT, true), key(VK.SHIFT, true)]);
  } else if (style === 'ctrl+shift+v') {
    sendKeys([key(VK.CONTROL), key(VK.SHIFT), key(VK.V), key(VK.V, true), key(VK.SHIFT, true), key(VK.CONTROL, true)]);
  } else {
    sendKeys([key(VK.CONTROL), key(VK.V), key(VK.V, true), key(VK.CONTROL, true)]);
  }
}

/** Riporta in primo piano la finestra memorizzata. Il tocco ad ALT sblocca SetForegroundWindow. */
function restoreForeground(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  if (IsIconic(hwnd)) ShowWindow(hwnd, 9);
  sendKeys([key(VK.MENU), key(VK.MENU, true)]);
  return SetForegroundWindow(hwnd);
}

module.exports = {
  sequenceNumber, foregroundWindow, windowAlive, clipboardSource, caretScreenPos,
  sendPasteKeys, restoreForeground, exeName, processExeOfWindow,
};
