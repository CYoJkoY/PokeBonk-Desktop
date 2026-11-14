import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { coalescedTask } = require('../out/adapters/coalesced-task.js');
const root = resolve('out', `state-benchmark-${Date.now()}`);
mkdirSync(root, { recursive: true });
const events = 500;
function measure(coalesce) {
  const file = join(root, coalesce ? 'coalesced.json' : 'baseline.json');
  let state, writes = 0;
  const save = () => {
    mkdirSync(root, { recursive: true });
    writeFileSync(file, JSON.stringify(state));
    writes++;
  };
  const task = coalescedTask(save);
  const start = performance.now();
  for (let index = 0; index < events; index++) {
    state = { x: index, y: index, width: 1280, height: 720, maximized: false, fullscreen: false };
    if (coalesce) task.schedule(); else save();
  }
  if (coalesce) task.flush();
  const elapsedMs = performance.now() - start;
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), state);
  return { writes, elapsedMs };
}
// Both paths perform real filesystem writes and produce identical final state.
const rounds = Array.from({ length: 5 }, () => ({ baseline: measure(false), coalesced: measure(true) }));
assert.ok(rounds.every(round => round.baseline.writes === events && round.coalesced.writes === 1));
const median = key => rounds.map(round => round[key].elapsedMs).sort((a, b) => a - b)[2];
const report = { events, rounds, baselineMedianMs: median('baseline'), coalescedMedianMs: median('coalesced'),
  writeReductionPercent: 99.8, node: process.version, platform: process.platform };
writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, output: root }, null, 2));
