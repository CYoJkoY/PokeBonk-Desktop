/**
 * `bun run benchmark:state`: the window state writes the client performs while the player drags a window, with and without
 * the coalescing task (src/adapters/coalesced-task.ts). Both paths write real files and must end in the same state.
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { coalescedTask } from '../adapters/coalesced-task';
import type { WinState } from '../domain/window-state';
import { ROOT } from './repo-root';

const EVENTS = 500;
const root = join(ROOT, 'out', `state-benchmark-${Date.now()}`);
mkdirSync(root, { recursive: true });

type Measurement = { writes: number; elapsedMs: number };

function measure(coalesce: boolean): Measurement {
  const file = join(root, coalesce ? 'coalesced.json' : 'baseline.json');
  let state: WinState = { width: 1280, height: 720 };
  let writes = 0;
  const save = (): void => {
    mkdirSync(root, { recursive: true });
    writeFileSync(file, JSON.stringify(state));
    writes++;
  };
  const task = coalescedTask(save);
  const start = performance.now();
  for (let index = 0; index < EVENTS; index++) {
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
assert.ok(rounds.every((round) => round.baseline.writes === EVENTS && round.coalesced.writes === 1));
const median = (pick: (round: (typeof rounds)[number]) => number): number => rounds.map(pick).sort((a, b) => a - b)[2];
const report = {
  events: EVENTS, rounds, baselineMedianMs: median((round) => round.baseline.elapsedMs), coalescedMedianMs: median((round) => round.coalesced.elapsedMs),
  writeReductionPercent: 99.8, node: process.version, platform: process.platform,
};
writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, output: root }, null, 2));
