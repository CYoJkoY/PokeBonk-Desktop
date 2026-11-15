import { expect, mock, test } from 'bun:test';
import { createNavigationPolicy } from '../src/navigation';

const handlers = new Map<string, (event: any, value?: unknown) => unknown>();
mock.module('electron', () => ({ ipcMain: {
  handle: (name: string, callback: any) => handlers.set(name, callback),
  on: (name: string, callback: any) => handlers.set(name, callback),
} }));
const { desktopBridge } = await import('../src/bridge');
const mainFrame = { url: 'https://pokebonk.com/play', origin: 'https://pokebonk.com' };
const webContents = { mainFrame };
const window = { isDestroyed: () => false, webContents, isFullScreen: () => true };
const bridge = desktopBridge(() => window as any, createNavigationPolicy('https://pokebonk.com', 'file:///app/offline.html'));
let effects = 0;
bridge.handle('read', () => 'ok');
bridge.on('write', () => { effects++; });
bridge.on('retry', () => { effects++; }, true);
bridge.fullscreen();
const event = (frame: unknown = mainFrame, sender: unknown = webContents) => ({ senderFrame: frame, sender });

test('allows the active game main frame', () => {
  expect(handlers.get('read')!(event())).toBe('ok');
  handlers.get('write')!(event());
  expect(effects).toBe(1);
});
test('rejects child frames, missing frames and other windows', () => {
  for (const e of [event({ ...mainFrame }), event(null), event(mainFrame, {}), event({ url: 'https://evil.test', origin: 'https://evil.test' })]) {
    expect(() => handlers.get('read')!(e)).toThrow('denied');
    handlers.get('write')!(e);
    expect(effects).toBe(1);
  }
});
test('offline page can retry but cannot change desktop settings', () => {
  mainFrame.url = 'file:///app/offline.html?lang=en'; mainFrame.origin = 'null';
  expect(() => handlers.get('read')!(event())).toThrow('denied');
  handlers.get('write')!(event());
  expect(effects).toBe(1);
  handlers.get('retry')!(event());
  expect(effects).toBe(2);
});
test('same URL with an opaque origin is denied', () => {
  mainFrame.url = 'https://pokebonk.com/play'; mainFrame.origin = 'null';
  expect(() => handlers.get('read')!(event())).toThrow('denied');
  const e = { ...event(), returnValue: undefined as unknown };
  handlers.get('pb:fullscreen')!(e);
  expect(e.returnValue).toBe(false);
});
