/**
 * `bun run smoke`: starts the real Electron client against loopback pages and checks what the pages and the client wrote.
 * Two page flows are covered: the game window with the preload bridge, and the offline page the client shows when the
 * game does not answer (its `<script src>` and the CSP that allows it). Everything it produces stays under `out/`.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { electronBinary } from './electron-binary';
import { readJson, record } from './json';
import { packageVersion, ROOT } from './repo-root';

const GAME_PAGE = '<!doctype html><html lang=en><title>Desktop smoke fixture</title><body><div id=ui><div class=screen>Desktop bridge smoke test</div></div></body></html>';
// Runs in the page, inside the async wrapper of --selftest-js, after the preload exposed pokebonkDesktop.
const BRIDGE_PROBE = `
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
// The offline page copies the query the client puts in its URL into its own text: that is the whole job of its script.
const OFFLINE_PROBE = `
    const query = new URLSearchParams(location.search);
    const title = document.getElementById('title');
    const retry = document.getElementById('retry');
    return {
      lang: document.documentElement.lang,
      copiedQuery: (title?.textContent ?? null) === (query.get('title') || '')
        && document.getElementById('text')?.textContent === (query.get('body') || '')
        && retry?.textContent === (query.get('retry') || 'Retry'),
      title: title?.textContent ?? '',
      retryHandler: typeof retry?.onclick === 'function',
      hasBridge: typeof window.pokebonkDesktop?.retry === 'function',
    };
  `;

function integer(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${what} is not an integer: ${String(value)}`);
  return value;
}

function addressOf(server: Server): string {
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The fixture server has no TCP address');
  return `http://127.0.0.1:${address.port}`;
}

/** Serves one page on a loopback port while `run` executes against it. */
async function serve<T>(html: string, run: (url: string) => Promise<T>): Promise<T> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(html);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  try {
    return await run(addressOf(server));
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/** A loopback URL that refuses connections: the client shows its own offline page instead of Chromium's error. */
async function refusedUrl(): Promise<string> {
  const server = createServer();
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  const url = addressOf(server);
  await new Promise<void>((closed) => server.close(() => closed()));
  return url;
}

/** Runs the real client (or the packaged executable) on `url` until it writes the self-test report. */
async function runClient(url: string, probe: string, output: string): Promise<Record<string, unknown>> {
  mkdirSync(output, { recursive: true });
  const probeFile = join(output, 'probe.js');
  writeFileSync(probeFile, probe);
  const packaged = process.argv[2];
  const args = [...(packaged ? [] : [ROOT]), `--url=${url}`, `--selftest=${output}`, `--selftest-js=${probeFile}`, '--selftest-wait=1000'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const child = spawn(packaged ? resolve(ROOT, packaged) : electronBinary(), args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
  const code = await new Promise<number | null>((exited, failed) => {
    const timer = setTimeout(() => { child.kill(); failed(new Error('Electron smoke test exceeded 45 seconds')); }, 45_000);
    child.once('error', (error) => { clearTimeout(timer); failed(error); });
    child.once('exit', (exitCode) => { clearTimeout(timer); exited(exitCode); });
  });
  assert.equal(code, 0, 'Electron exited with a failure');
  return readJson(join(output, 'report.json'), 'report.json');
}

function checkBridgeReport(report: Record<string, unknown>, script: Record<string, unknown>): void {
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
}

function checkPersistedProfile(output: string, script: Record<string, unknown>): void {
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
}

async function checkGameWindow(): Promise<void> {
  const output = join(ROOT, 'out', `smoke-${Date.now()}`);
  mkdirSync(join(output, 'profile'), { recursive: true });
  writeFileSync(join(output, 'profile', 'window.json'), JSON.stringify({ width: 960, height: 540, fullscreen: false }));
  const report = await serve(GAME_PAGE, (url) => runClient(url, BRIDGE_PROBE, output));
  const script = record(report.script, 'report.script');
  checkBridgeReport(report, script);
  checkPersistedProfile(output, script);
  console.log(`Electron smoke test passed: ${output}`);
}

/** The page has to run its compiled script: a broken `<script src>` or a CSP that drops `file:` leaves it blank. */
async function checkOfflinePage(): Promise<void> {
  const output = join(ROOT, 'out', `smoke-offline-${Date.now()}`);
  const report = await runClient(await refusedUrl(), OFFLINE_PROBE, output);
  const page = record(report.script, 'report.script');
  assert.equal(page.copiedQuery, true, 'The offline page did not run out/renderer/offline.js');
  assert.equal(page.retryHandler, true, 'The offline page has no retry handler');
  assert.equal(page.hasBridge, true, 'The offline page has no preload bridge');
  assert.ok(typeof page.title === 'string' && page.title.length > 0, 'The offline page has no title');
  assert.ok(typeof page.lang === 'string' && page.lang.length > 0, 'The offline page has no lang');
  console.log(`Offline page passed: ${output}`);
}

async function smoke(): Promise<void> {
  await checkGameWindow();
  await checkOfflinePage();
}

void smoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
