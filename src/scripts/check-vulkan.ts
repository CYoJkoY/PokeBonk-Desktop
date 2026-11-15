/**
 * `bun run verify:vulkan` (interactive Windows desktop only): the 1.5.1 regression. A fullscreen window can render with the
 * hardware Vulkan backend while the desktop shows a solid gray frame, so this samples the real screen through PowerShell.
 */
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { isRecord } from '../domain/config';
import { ROOT } from './repo-root';

const FIXTURE = `<!doctype html><title>Vulkan presentation diagnostic</title>
    <style>html,body{margin:0;overflow:hidden}canvas{display:block;width:100vw;height:100vh}</style>
    <canvas></canvas><div id=ui><div class=screen></div></div><script>
    const canvas = document.querySelector('canvas');
    const gl = canvas.getContext('webgl2', {antialias:false});
    function draw() {
      canvas.width=innerWidth; canvas.height=innerHeight;
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0,0,canvas.width/2,canvas.height);
      gl.clearColor(1,0,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.scissor(canvas.width/2,0,canvas.width,canvas.height);
      gl.clearColor(0,0,1,1); gl.clear(gl.COLOR_BUFFER_BIT);
      requestAnimationFrame(draw);
    }
    draw();</script>`;

/** JSON read back from a diagnostic file is unknown until it is narrowed here. */
function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not an object`);
  return value;
}

/** One pixel of the real desktop, as the capture script reports it. */
function rgb(value: unknown, what: string): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) throw new Error(`${what} is not an RGB triple`);
  const [red, green, blue]: unknown[] = value;
  if (typeof red !== 'number' || typeof green !== 'number' || typeof blue !== 'number') throw new Error(`${what} is not numeric`);
  return [red, green, blue];
}

function capture(args: string[]): Promise<string> {
  return new Promise((done, failed) => {
    execFile('powershell.exe', args, { windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      if (error) failed(error); else done(stdout);
    });
  });
}

function electronBinary(): string {
  const binary: unknown = require('electron');
  if (typeof binary !== 'string') throw new Error('The electron package did not resolve to an executable path');
  return binary;
}

async function vulkan(): Promise<void> {
  assert.equal(process.platform, 'win32', 'This presentation regression check requires an interactive Windows desktop.');
  const output = join(ROOT, 'out', `vulkan-presentation-${Date.now()}`);
  mkdirSync(join(output, 'profile'), { recursive: true });
  writeFileSync(join(output, 'profile', 'client.json'), JSON.stringify({ angle: 'vulkan', vsync: true, discord: false }));
  writeFileSync(join(output, 'profile', 'window.json'), JSON.stringify({ fullscreen: true, width: 960, height: 540 }));
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(FIXTURE);
  });
  await new Promise<void>((listening) => server.listen(0, '127.0.0.1', listening));
  let child: ChildProcess | undefined;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('The fixture server has no TCP address');
    const packaged = process.argv[2];
    const args = packaged ? [] : [ROOT];
    args.push(`--url=http://127.0.0.1:${address.port}`, `--selftest=${output}`, '--selftest-wait=12000');
    child = spawn(packaged ? resolve(packaged) : electronBinary(), args, { cwd: ROOT, stdio: 'inherit', windowsHide: true });
    const current = child;
    const exited = new Promise<number | null>((done, failed) => {
      watchdog = setTimeout(() => { current.kill(); failed(new Error('Vulkan diagnostic exceeded 35 seconds')); }, 35_000);
      current.once('error', failed);
      current.once('exit', (code) => done(code));
    });
    const captured = (async (): Promise<unknown> => {
      await new Promise<void>((settled) => setTimeout(settled, 5000));
      const stdout = await capture([
        '-NoProfile', '-File', join(ROOT, 'scripts', 'capture-presentation.ps1'),
        '-ExpectedProcessId', String(current.pid), '-OutputFile', join(output, 'desktop.png'),
      ]);
      return JSON.parse(stdout.trim());
    })();
    const [code, reported] = await Promise.all([exited, captured]);
    assert.equal(code, 0);
    const pixels = record(reported, 'presentation capture');
    writeFileSync(join(output, 'presentation.json'), JSON.stringify(pixels, null, 2));
    const report = record(JSON.parse(readFileSync(join(output, 'report.json'), 'utf8')), 'report.json');
    const webgl = record(report.webgl, 'report.webgl');
    const renderer = webgl.renderer;
    if (typeof renderer !== 'string') throw new Error('report.webgl.renderer is not a string');
    assert.match(renderer, /Vulkan/);
    assert.doesNotMatch(renderer, /SwiftShader|llvmpipe|Software/i);
    assert.equal(record(report.gpuFeatures, 'report.gpuFeatures').gpu_compositing, 'enabled');
    const left = rgb(pixels.left, 'pixels.left');
    const right = rgb(pixels.right, 'pixels.right');
    assert.ok(left[0] > 240 && left[1] < 15 && left[2] < 15, `Desktop left pixel is not red: ${left.join(',')}`);
    assert.ok(right[0] < 15 && right[1] < 15 && right[2] > 240, `Desktop right pixel is not blue: ${right.join(',')}`);
    console.log(`Hardware Vulkan and desktop presentation passed: ${output}`);
  } finally {
    clearTimeout(watchdog);
    if (child && child.exitCode === null) child.kill();
    server.closeAllConnections();
    server.close();
  }
}

void vulkan().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
