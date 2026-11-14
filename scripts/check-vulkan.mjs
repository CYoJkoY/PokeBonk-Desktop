import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

assert.equal(process.platform, 'win32', 'This presentation regression check requires an interactive Windows desktop.');
const require = createRequire(import.meta.url);
const output = resolve('out', `vulkan-presentation-${Date.now()}`);
mkdirSync(join(output, 'profile'), { recursive: true });
writeFileSync(join(output, 'profile', 'client.json'), JSON.stringify({ angle: 'vulkan', vsync: true, discord: false }));
writeFileSync(join(output, 'profile', 'window.json'), JSON.stringify({ fullscreen: true, width: 960, height: 540 }));
const server = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>Vulkan presentation diagnostic</title>
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
    draw();</script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let child;
let timeout;
try {
  const executable = process.argv[2] ? resolve(process.argv[2]) : require('electron');
  const args = process.argv[2] ? [] : ['.'];
  args.push(`--url=http://127.0.0.1:${server.address().port}`, `--selftest=${output}`, '--selftest-wait=12000');
  child = spawn(executable, args, { stdio: 'inherit', windowsHide: true });
  const exited = new Promise((resolve, reject) => {
    timeout = setTimeout(() => { child.kill(); reject(new Error('Vulkan diagnostic exceeded 35 seconds')); }, 35000);
    child.once('error', reject);
    child.once('exit', code => resolve(code));
  });
  const captured = (async () => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const { stdout } = await promisify(execFile)('powershell.exe', [
      '-NoProfile', '-File', resolve('scripts/capture-presentation.ps1'),
      '-ExpectedProcessId', String(child.pid), '-OutputFile', join(output, 'desktop.png'),
    ], { windowsHide: true, timeout: 10000 });
    return JSON.parse(stdout.trim());
  })();
  const [code, pixels] = await Promise.all([exited, captured]);
  assert.equal(code, 0);
  writeFileSync(join(output, 'presentation.json'), JSON.stringify(pixels, null, 2));
  const report = JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'));
  assert.match(report.webgl?.renderer ?? '', /Vulkan/);
  assert.doesNotMatch(report.webgl.renderer, /SwiftShader|llvmpipe|Software/i);
  assert.equal(report.gpuFeatures.gpu_compositing, 'enabled');
  assert.ok(pixels.left[0] > 240 && pixels.left[1] < 15 && pixels.left[2] < 15, `Desktop left pixel is not red: ${pixels.left}`);
  assert.ok(pixels.right[0] < 15 && pixels.right[1] < 15 && pixels.right[2] > 240, `Desktop right pixel is not blue: ${pixels.right}`);
  console.log(`Hardware Vulkan and desktop presentation passed: ${output}`);
} finally {
  clearTimeout(timeout);
  if (child && child.exitCode === null) child.kill();
  server.closeAllConnections();
  server.close();
}
