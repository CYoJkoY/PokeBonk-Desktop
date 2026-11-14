import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const output = resolve('out', `smoke-${Date.now()}`);
mkdirSync(join(output, 'profile'), { recursive: true });
writeFileSync(join(output, 'profile', 'window.json'), JSON.stringify({ width: 960, height: 540, fullscreen: false }));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><html lang=en><title>Desktop smoke fixture</title><body><div id=ui><div class=screen>Desktop bridge smoke test</div></div></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  const { port } = server.address();
  const script = join(output, 'assert-bridge.js');
  writeFileSync(script, `
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
  `);
  const packaged = process.argv[2];
  const electronArgs = [...(packaged ? [] : ['.']), `--url=http://127.0.0.1:${port}`, `--selftest=${output}`, `--selftest-js=${script}`, '--selftest-wait=1000'];
  if (process.platform === 'linux') electronArgs.push('--no-sandbox');
  const child = spawn(packaged ? resolve(packaged) : require('electron'), electronArgs, { stdio: 'inherit', windowsHide: true });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Electron smoke test exceeded 45 seconds')); }, 45_000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', code => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(code, 0);
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.equal(report.script?.version, require('../package.json').version);
  assert.equal(report.script?.invalidRejected, true);
  assert.equal(report.script?.after.discord, false);
  assert.equal(report.script?.after.vsyncNext, false);
  assert.equal(report.script?.after.angleNext, 'gl');
  assert.equal(report.script?.after.mode, 'window');
  assert.equal(report.script?.fullscreen, false);
  assert.equal(report.script?.unsubscribeAvailable, true);
  assert.ok(report.webgl?.desktop?.includes('setDisplay'));
  const settings = JSON.parse(readFileSync(join(output, 'profile', 'client.json'), 'utf8'));
  assert.equal(settings.discord, false);
  assert.equal(settings.vsync, false);
  assert.equal(settings.angle, 'gl');
  const bounds = JSON.parse(readFileSync(join(output, 'profile', 'window.json'), 'utf8'));
  // Compare observed logical bounds, including native decorations and clamping.
  for (const key of ['width', 'height']) {
    const observed = report.script.windowBounds[key];
    assert.ok(Number.isSafeInteger(observed) && observed > 0);
    assert.ok(Math.abs(bounds[key] - observed) <= 2,
      `Saved ${key} ${bounds[key]} differs from observed ${observed}`);
  }
  assert.equal(bounds.fullscreen, false);
  console.log(`Electron smoke test passed: ${output}`);
} finally { server.closeAllConnections(); server.close(); }
