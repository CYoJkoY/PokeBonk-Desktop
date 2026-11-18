/**
 * `bun run smoke`: starts the real Electron client against loopback pages and checks what the pages and the client wrote.
 * Three page flows are covered: the game window with the preload bridge, the offline page the client shows when the game
 * does not answer, and the loading screen. Every local page runs a compiled `<script src>`, so its CSP has to allow it and
 * the relative path has to resolve. Everything it produces stays under `out/`.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
// A boot that never reaches a menu: the loading screen stays up, and src/main.ts keeps pushing its bar through window.pb.
const BOOT_PAGE = '<!doctype html><html lang=es><title>Loading screen fixture</title><body><div id=ui>'
  + '<div class=loading><div class=bar><i style="transform:scaleX(0.5)"></i><b>Cargando Pokédex…</b></div></div></div></body></html>';

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

type ClientRun = { url: string; output: string; probe?: string; wait?: number; splash?: boolean };

/** The self-test reports by itself after this long, so a stuck client is a report, not a silent kill. */
const CLIENT_DEADLINE_MS = 30_000;
/** Its own hard limit, above the deadline: a client that ignores the deadline is killed and the log says where it stopped. */
const CLIENT_TIMEOUT_MS = 45_000;

/** The client's own output, kept next to its report: on a failure it is all the run has to say for itself. */
function clientLog(output: string): string {
  const file = join(output, 'client.log');
  try {
    const lines = readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
    return lines.slice(-12).join('\n');
  } catch {
    return '(the client printed nothing)';
  }
}

/**
 * A client that ignores its deadline has to go, and so do its pipes: SIGTERM left the process retrying for minutes,
 * and the open pipes kept this harness alive after the failure, long past the point where the job could report it.
 */
function killClient(child: ChildProcess): void {
  child.kill('SIGKILL');
  child.stdout?.destroy();
  child.stderr?.destroy();
}

/** Why a run produced no usable report: the self-test deadline, a crash, or a kill. */
function failureDetail(output: string, code: number | null): string {
  const report = join(output, 'report.json');
  if (existsSync(report)) {
    try {
      const parsed = readJson(report, 'report.json');
      const events = Array.isArray(parsed.events) ? parsed.events.join(' > ') : '';
      return `report says ${String(parsed.loaded)}${parsed.error ? ` (${String(parsed.error)})` : ''}${events ? `: ${events}` : ''}`;
    } catch { /* unreadable report: fall through to the log */ }
  }
  return `exit ${String(code)}, no report; log:\n${clientLog(output)}`;
}

/** Runs the real client (or the packaged executable) on `url` until it writes the self-test report. */
async function runClient({ url, output, probe, wait = 1000, splash = false }: ClientRun): Promise<Record<string, unknown>> {
  mkdirSync(output, { recursive: true });
  const packaged = process.argv[2];
  const args = [...(packaged ? [] : [ROOT]), `--url=${url}`, `--selftest=${output}`, `--selftest-wait=${wait}`,
    `--selftest-deadline=${CLIENT_DEADLINE_MS}`];
  if (probe) {
    const probeFile = join(output, 'probe.js');
    writeFileSync(probeFile, probe);
    args.push(`--selftest-js=${probeFile}`);
  }
  // The loading screen over the game: the report carries the page's own DOM (src/main.ts, `readSplashPage`).
  if (splash) args.push('--splash');
  if (process.platform === 'linux') args.push('--no-sandbox');
  const spawned = packaged ? resolve(ROOT, packaged) : electronBinary();
  const log = createWriteStream(join(output, 'client.log'));
  const child = spawn(spawned, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => { log.write(chunk); process.stderr.write(chunk); });
  }
  try {
    const code = await new Promise<number | null>((exited, failed) => {
      const timer = setTimeout(() => {
        killClient(child);
        failed(new Error(`Electron smoke test exceeded ${CLIENT_TIMEOUT_MS / 1000} s: ${failureDetail(output, null)}`));
      }, CLIENT_TIMEOUT_MS);
      child.once('error', (error) => { clearTimeout(timer); failed(error); });
      child.once('exit', (exitCode) => { clearTimeout(timer); exited(exitCode); });
    });
    assert.equal(code, 0, `Electron exited with a failure: ${failureDetail(output, code)}`);
    return readJson(join(output, 'report.json'), 'report.json');
  } finally {
    log.end();
  }
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
  const report = await serve(GAME_PAGE, (url) => runClient({ url, probe: BRIDGE_PROBE, output }));
  const script = record(report.script, 'report.script');
  checkBridgeReport(report, script);
  checkPersistedProfile(output, script);
  console.log(`Electron smoke test passed: ${output}`);
}

/** The page has to run its compiled script: a broken `<script src>` or a CSP that drops `file:` leaves it blank. */
async function checkOfflinePage(): Promise<void> {
  const output = join(ROOT, 'out', `smoke-offline-${Date.now()}`);
  const report = await runClient({ url: await refusedUrl(), probe: OFFLINE_PROBE, output });
  const page = record(report.script, 'report.script');
  assert.equal(page.copiedQuery, true, 'The offline page did not run out/pages/offline.js');
  assert.equal(page.retryHandler, true, 'The offline page has no retry handler');
  assert.equal(page.hasBridge, true, 'The offline page has no preload bridge');
  assert.ok(typeof page.title === 'string' && page.title.length > 0, 'The offline page has no title');
  assert.ok(typeof page.lang === 'string' && page.lang.length > 0, 'The offline page has no lang');
  console.log(`Offline page passed: ${output}`);
}

/**
 * The loading screen is a local page too: it has to run its own compiled script (its `<script src>`), copy the text the
 * client puts in the query, load its illustration and answer window.pb while src/main.ts drives the boot.
 */
async function checkSplashPage(): Promise<void> {
  const output = join(ROOT, 'out', `smoke-splash-${Date.now()}`);
  // Long enough for the illustration and for the boot's bar, which src/main.ts sets on dom-ready and then follows.
  const report = await serve(BOOT_PAGE, (url) => runClient({ url, output, splash: true, wait: 4000 }));
  const page = record(report.splashPage, 'report.splashPage');
  assert.equal(page.bridge, true, 'static/splash.html did not define window.pb');
  assert.equal(page.ver, `v${packageVersion()}`, 'The loading screen did not show the client version');
  assert.ok(typeof page.lang === 'string' && page.lang.length > 0, 'The loading screen has no lang');
  assert.equal(page.tipHidden, false, 'The loading screen shows no tips');
  for (const key of ['label', 'tipLabel', 'tip'] as const) {
    assert.ok(typeof page[key] === 'string' && (page[key] as string).length > 0, `The loading screen has no ${key}`);
  }
  // The fixture reports its own load at 0.5, so src/main.ts sets 0.2 + 0.72 · 0.5 through window.pb.set.
  const bar = /^scaleX\(([\d.]+)\)$/.exec(String(page.bar));
  assert.ok(bar, `The loading screen's bar carries no progress: ${String(page.bar)}`);
  assert.ok(Math.abs(Number(bar[1]) - 0.56) < 0.01, `window.pb.set did not move the bar to 0.56: ${bar[1]}`);
  assert.equal(page.revealed, true, 'The loading screen did not load its illustration');
  console.log(`Loading screen passed: ${output}`);
}

async function smoke(): Promise<void> {
  await checkGameWindow();
  await checkOfflinePage();
  await checkSplashPage();
}

void smoke().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
