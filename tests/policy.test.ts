import { describe, expect, test } from 'bun:test';
import { anglesFor, parseConfig, parseDisplayPatch } from '../src/domain/config';
import { createNavigationPolicy } from '../src/domain/navigation';
import { parseDistribution } from '../src/domain/distribution';
import { parseWindowState } from '../src/domain/window-state';

describe('remote content boundary', () => {
  const policy = createNavigationPolicy('https://pokebonk.com', 'file:///app/static/offline.html');
  test('allows game paths and the exact offline page', () => {
    expect(policy.isGame('https://pokebonk.com/play?lang=en')).toBe(true);
    expect(policy.isOffline('file:///app/static/offline.html?lang=es#retry')).toBe(true);
  });
  test.each([
    'https://pokebonk.com.evil.test', 'https://evil.pokebonk.com', 'https://pokebonk.com:8443',
    'http://pokebonk.com', 'https://evil.test@pokebonk.com', 'file:///app/package.json',
    'about:blank', 'javascript:alert(1)', 'blob:https://pokebonk.com/id', 'not a URL',
  ])('denies navigation to %s', value => expect(policy.mayNavigate(value)).toBe(false));
  test('allows explicit loopback development only', () => {
    expect(createNavigationPolicy('http://localhost:5173', '').isGame('http://localhost:5173/play')).toBe(true);
    expect(() => createNavigationPolicy('http://remote.test', '')).toThrow();
    expect(() => createNavigationPolicy('file:///game.html', '')).toThrow();
  });
});
describe('settings contracts', () => {
  const angles = anglesFor('win32');
  test('loads existing settings and repairs invalid values individually', () => {
    expect(parseConfig({ vsync: false, discord: false, angle: 'gl', lastArt: 'forest' }, angles)).toEqual({ vsync: false, discord: false, angle: 'gl', lastArt: 'forest' });
    expect(parseConfig({ vsync: 'false', discord: 0, angle: 'metal', lastArt: '../x' }, angles)).toEqual({ vsync: true, discord: true, angle: 'auto' });
    expect(parseConfig(null, angles)).toEqual({ vsync: true, discord: true, angle: 'auto' });
  });
  for (const [i, value] of [null, [], 'window', { discord: 'false' }, { vsync: 1 }, { monitor: -1 }, { monitor: 0.5 }, { monitor: Infinity }, { size: '0x0' }, { size: '9999x9999' }, { mode: 'other' }, { angle: 'metal' }, { unknown: true }].entries()) {
    test(`rejects invalid request ${i} before effects`, () => expect(() => parseDisplayPatch(value, angles)).toThrow());
  }
  test('accepts existing game payloads', () => {
    const p = { mode: 'window', size: '1920x1080', monitor: 1, discord: false, vsync: true, angle: 'd3d11' };
    expect(parseDisplayPatch(p, angles)).toEqual(p);
    expect(parseDisplayPatch({ size: 'max' }, angles)).toEqual({ size: 'max' });
  });
  test('platform backends remain explicit', () => {
    expect(anglesFor('darwin')).toEqual(['auto', 'metal', 'gl']);
    expect(anglesFor('linux')).toEqual(['auto', 'gl', 'vulkan']);
  });
});
test('distribution is validated and updates require an explicit boolean', () => {
  const config = { schemaVersion: '1.0.0', discordAppId: '1566885621853716540', updates: { enabled: false, owner: 'CYoJkoY', repo: 'PokeBonk-Desktop' } };
  expect(parseDistribution(config)).toEqual(config);
  expect(() => parseDistribution({ ...config, schemaVersion: '2.0.0' })).toThrow();
  expect(() => parseDistribution({ ...config, updates: { ...config.updates, enabled: 'true' } })).toThrow();
  expect(() => parseDistribution({ ...config, updates: { ...config.updates, owner: 'https://evil.test' } })).toThrow();
});
test('window state rejects damaged dimensions and preserves negative monitor positions', () => {
  expect(parseWindowState({ width: 1280, height: 720, x: -1280, y: 0, fullscreen: true })).toEqual({ width: 1280, height: 720, x: -1280, y: 0, fullscreen: true, maximized: false });
  for (const value of [null, [], { width: '1280', height: 720 }, { width: 1280, height: -1 }, { width: Infinity, height: 720 }]) {
    expect(() => parseWindowState(value)).toThrow();
  }
});
