'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'clips:list', 'clips:get', 'clips:paste', 'clips:copy', 'clips:delete', 'clips:pin', 'clips:update-text',
  'clips:set-meta', 'clips:labels', 'clips:move', 'clips:new', 'clips:export-text', 'clips:export-image',
  'labels:list', 'labels:create', 'labels:update', 'labels:delete',
  'settings:get', 'settings:set', 'settings:meta',
  'window:hide', 'window:settings', 'window:suppress-blur', 'app:quit', 'clipboard:toggle',
  'data:export', 'data:import', 'data:backup', 'data:restore', 'data:compact', 'data:clear',
  'data:delete-unused', 'data:stats', 'sync:send', 'sync:test', 'hotkey:labels',
]);
const EVENTS = new Set(['list:changed', 'popup:show', 'popup:hide', 'settings:changed', 'settings:tab', 'toast']);

contextBridge.exposeInMainWorld('crisp', {
  invoke: (channel, payload) => {
    if (!INVOKE.has(channel)) throw new Error('canale non consentito: ' + channel);
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) throw new Error('evento non consentito: ' + channel);
    const fn = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
