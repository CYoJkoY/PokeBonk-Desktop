import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { electronBinary } from './electron-binary';
import { FRAME_PROBE_DEFAULTS, frameProbe, frameSpikes, frameStats } from './frame-probe';
import { readJson, record } from './json';
import { ROOT } from './repo-root';

const BENCHMARK = { deadlineMarginMs: 20_000, timeoutMarginMs: 10_000, width: 1280, height: 720, cells: 64 } as const;
const argument = (name: string): string | undefined => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);

function positive(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
  return value;
}

const config = {
  ...FRAME_PROBE_DEFAULTS,
  warmupMs: positive(Number(argument('warmup') ?? FRAME_PROBE_DEFAULTS.warmupMs), 'warmup'),
  durationMs: positive(Number(argument('duration') ?? FRAME_PROBE_DEFAULTS.durationMs), 'duration'),
  budgetMs: 1000 / positive(Number(argument('hz') ?? 60), 'hz'),
};
const output = join(ROOT, 'out', `runtime-benchmark-${Date.now()}`);
const appRoot = resolve(ROOT, argument('app') ?? '.');
mkdirSync(join(output, 'profile'), { recursive: true });
writeFileSync(join(output, 'profile', 'window.json'), JSON.stringify({ width: BENCHMARK.width, height: BENCHMARK.height, fullscreen: false }));
const setup = argument('setup');
writeFileSync(join(output, 'probe.js'), (setup === undefined ? '' : readFileSync(resolve(ROOT, setup), 'utf8')) + '\n' + frameProbe(config));

const page = `<!doctype html><html lang=en><title>Frame stability fixture</title>
<style>html,body{margin:0;overflow:hidden;background:#182030}canvas{width:100vw;height:100vh}</style>
<canvas width=${BENCHMARK.width} height=${BENCHMARK.height}></canvas>
<div id=ui><div class=loading><div class=bar><i style="transform:scaleX(0.5)"></i><b>Loading fixture</b></div></div></div>
<script>
const canvas = document.querySelector('canvas');
const gl = canvas.getContext('webgl2', {antialias:false});
if (!gl) throw new Error('WebGL2 unavailable');
gl.enable(gl.SCISSOR_TEST);
function draw(time) {
  for (let index = 0; index < ${BENCHMARK.cells}; index++) {
    gl.scissor((index % 8) * 160, Math.floor(index / 8) * 90, 160, 90);
    gl.clearColor((index % 7) / 7, 0.3 + Math.sin(time / 1000) * 0.2, (index % 5) / 5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
setTimeout(() => document.getElementById('ui').innerHTML = '<div class=screen>Ready</div>', 1500);
</script>`;

async function launch(url: string): Promise<void> {
  const deadline = config.warmupMs + config.durationMs + BENCHMARK.deadlineMarginMs;
  const args = [appRoot, `--url=${url}`, `--selftest=${output}`, '--selftest-wait=500',
    `--selftest-deadline=${deadline}`, `--selftest-js=${join(output, 'probe.js')}`, '--selftest-metrics', '--splash'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  const child = spawn(electronBinary(), args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => { child.kill(); fail(new Error(`Benchmark timed out: ${output}`)); }, deadline + BENCHMARK.timeoutMarginMs);
    child.once('error', error => { clearTimeout(timer); fail(error); });
    child.once('exit', code => {
      clearTimeout(timer);
      if (code !== 0) return fail(new Error(`Benchmark exited ${String(code)}: ${output}`));
      done();
    });
  });
}

function memoryTotals(value: unknown): { workingSetKiB: number; privateKiB: number | null; contents: number } {
  const sample = record(value, 'memory sample');
  if (!Array.isArray(sample.processes)) throw new Error('Missing process metrics');
  const memories = sample.processes.map(value => record(record(value, 'process').memory, 'process memory'));
  const workingSetKiB = memories.reduce((sum, memory) => {
    if (typeof memory.workingSetSize !== 'number' || memory.workingSetSize < 0) throw new Error('Invalid working set');
    return sum + memory.workingSetSize;
  }, 0);
  const privateKiB = memories.every(memory => typeof memory.privateBytes === 'number')
    ? memories.reduce((sum, memory) => sum + Number(memory.privateBytes), 0) : null;
  return { workingSetKiB, privateKiB, contents: Number(sample.contents) };
}

function summarize(): void {
  const report = readJson(join(output, 'report.json'), 'benchmark report');
  const frames = record(report.script, 'frame probe');
  if (!Array.isArray(frames.intervalsMs)) throw new Error(`Frame probe failed: ${JSON.stringify(frames)}`);
  const intervals = frames.intervalsMs.map(value => positive(value, 'frame interval'));
  const measurements = record(report.measurements, 'measurements');
  if (!Array.isArray(measurements.samples) || measurements.samples.length === 0) throw new Error('No memory samples');
  const memory = measurements.samples.map(memoryTotals);
  const summary = {
    appRoot, url: report.url, config, platform: process.platform, electron: report.electron, chrome: report.chrome,
    gpu: report.gpu, renderer: report.webgl, screen: frames.screen,
    validForegroundSample: frames.lostFocus === false && frames.hidden === false && frames.capped === false && measurements.capped === false,
    frames: frameStats(intervals, config.budgetMs), work: measurements.work,
    longFrames: frameSpikes(intervals, 50),
    peakSampledWorkingSetKiB: Math.max(...memory.map(sample => sample.workingSetKiB)),
    peakSampledPrivateKiB: memory.reduce<number | null>((peak, sample) =>
      peak === null || sample.privateKiB === null ? null : Math.max(peak, sample.privateKiB), 0),
    settled: memory.at(-1), output,
  };
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

async function main(): Promise<void> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(page);
  });
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready));
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('No fixture port');
    await launch(argument('url') ?? `http://127.0.0.1:${address.port}`);
    summarize();
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
