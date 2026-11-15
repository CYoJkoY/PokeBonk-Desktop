/**
 * `bun run smoke`: starts the real Electron client against a loopback fixture, drives the bridge from the page and checks
 * the settings and window files the client wrote. Everything it produces stays under `out/`, which never ships.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { isRecord } from '../domain/config';
import { packageVersion, ROOT } from './repo-root';

const PAGE = '<!doctype html><html lang=en><title>Desktop smoke fixture</title><body><div id=ui><div class=screen>Desktop bridge smoke test</div></div></body></html>';
// Runs in the page, inside the async wrapper of --selftest-js, after the preload exposed pokebonkDesktop.
const PROBE = `
    const api = window.pokebonkDesktop;
    const before = await api.display();
    let invalidRejected = false;
    try { await api.setDisplay({ discord: 'false' }); } catch { invalidRejected = true; }
    const after = await api.setDisplay({ mode: 'window', size: '1280x720', discord: false, vsync: false, angle: 'gl' });
    const unsubscribe = api.update.onChange(() => {});
    const unsubscribeAvailable = typeof unsubscribe === 'function';
    unsubscribe();
    // Let native resizing and the trailing persistence task settle. CI desktops
    // may clamp requested sizes to their available work area.
    await new Promise(resolve => setTimeout(resolve, 500));
    return { version: api.version, fullscreen: api.fullscreen(), before, after, invalidRejected, unsubscribeAvailable,
      windowBounds: { width: outerWidth, height: outerHeight } };
  `;

/** JSON read back from a diagnostic file is unknown until it is narrowed here. */
function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not an object`);
  return value;
}

function readJson(file: string, what: string): Record<string, unknown> {
  return record(JSON.parse(readFileSync(file, 'utf8')), what);
}

function integer(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${what} is not an integer: ${String(value)}`);
  return value;
}

function electronBinary(): string {
  const binary: unknown = require('electron');
  if (typeof binary !== 'string') throw new Error('The electron package did not resolve to an executable path');
  return binary;
}

async function smoke(): Promise<void> {
  const output = join(ROOT, 'out', `smoke-${Date.now()}`);
  mkdirSync(join(output, 'profile'), { recursive: true });
  writeFileSync(join(output, 'profile', 'window.json'), JSON.stringify({ width: 960, height: 540, fullscreen: false }));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(PAGE);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The fixture server has no TCP address');
    const probe = join(output, 'assert-bridge.js');
    writeFileSync(probe, PROBE);
    const packaged = process.argv[2];
    const electronArgs = [...(packaged ? [] : [ROOT]), `--url=http://127.0.0.1:${address.port}`, `--selftest=${output}`, `--selftest-js=${probe}`, '--selftest-wait=1000'];
    if (process.platform === 'linux') electronArgs.push('--no-sandbox');
    const child = spawn(packaged ? resolve(packaged) : electronBinary(), electronArgs, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    const code = await new Promise<number | null>((exited, failed) => {
      const timer = setTimeout(() => { child.kill(); failed(new Error('Electron smoke test exceeded 45 seconds')); }, 45_000);
      child.once('error', (error) => { clearTimeout(timer); failed(error); });
      child.once('exit', (exitCode) => { clearTimeout(timer); exited(exitCode); });
    });
    assert.equal(code, 0, 'Electron exited with a failure');
    const report = readJson(join(output, 'report.json'), 'report.json');
    const script = record(report.script, 'report.script');
    assert.equal(script.version, packageVersion());
    assert.equal(script.invalidRejected, true);
    const after = record(script.after, 'report.script.after');
    assert.equal(after.discord, false);
    assert.equal(after.vsyncNext, false);
    assert.equal(after.angleNext, 'gl');
    assert.equal(after.mode, 'window');
    assert.equal(script.fullscreen, false);
    assert.equal(script.unsubscribeAvailable, true);
    const desktop = record(report.webgl, 'report.webgl').desktop;
    assert.ok(typeof desktop === 'string' && desktop.includes('setDisplay'), 'The preload bridge does not expose setDisplay');
    const settings = readJson(join(output, 'profile', 'client.json'), 'client.json');
    assert.equal(settings.discord, false);
    assert.equal(settings.vsync, false);
    assert.equal(settings.angle, 'gl');
    const bounds = readJson(join(output, 'profile', 'window.json'), 'window.json');
    const observed = record(script.windowBounds, 'report.script.windowBounds');
    // Compare observed logical bounds, including native decorations and clamping.
    for (const key of ['width', 'height'] as const) {
      const seen = integer(observed[key], `report.script.windowBounds.${key}`);
      assert.ok(seen > 0, `Observed ${key} ${seen} is not positive`);
      const saved = integer(bounds[key], `window.json ${key}`);
      assert.ok(Math.abs(saved - seen) <= 2, `Saved ${key} ${saved} differs from observed ${seen}`);
    }
    assert.equal(bounds.fullscreen, false);
    console.log(`Electron smoke test passed: ${output}`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

void smoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
