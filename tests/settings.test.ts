import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileSettings } from '../src/settings';
import { anglesFor } from '../src/config';

test('settings adapter preserves existing values, reports corruption and recovers', () => {
  const root = mkdtempSync(join(tmpdir(), 'pokebonk-settings-'));
  try {
    const errors: string[] = [];
    const file = join(root, 'client.json');
    const store = fileSettings(file, anglesFor('win32'), message => errors.push(message));
    expect(store.read()).toEqual({ vsync: true, angle: 'auto', discord: true });
    expect(errors).toEqual([]);
    writeFileSync(file, JSON.stringify({ vsync: false, angle: 'gl', discord: true }));
    store.write({ discord: false });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ vsync: false, angle: 'gl', discord: false });
    writeFileSync(file, '{broken');
    expect(store.read().angle).toBe('auto');
    expect(errors).toHaveLength(1);
    store.write({ angle: 'd3d11' });
    expect(store.read().angle).toBe('d3d11');
  } finally {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes('pokebonk-settings-')) throw new Error('Invalid test cleanup path');
    rmSync(root, { recursive: true });
  }
});
