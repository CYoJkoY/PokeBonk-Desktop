import { expect, test } from 'bun:test';
import { startBootWatch, type BootObservation, type BootWatchOptions } from '../src/boot-watch';

type Fixture = {
  options: BootWatchOptions;
  scheduled: (() => void)[];
  progress: { progress: number; label: string | undefined }[];
  counters: { screens: number; asks: number; timeouts: number; ends: number };
};

function fixture(observations: (BootObservation | null)[], active = true): Fixture {
  const scheduled: (() => void)[] = [];
  const progress: { progress: number; label: string | undefined }[] = [];
  const counters = { screens: 0, asks: 0, timeouts: 0, ends: 0 };
  const options: BootWatchOptions = {
    read: async () => observations.shift() ?? null,
    isActive: () => active,
    onProgress: (value, label) => progress.push({ progress: value, label }),
    onScreen: () => { counters.screens++; },
    onAsks: () => { counters.asks++; },
    onTimeout: () => { counters.timeouts++; },
    now: () => 0,
    schedule: (task) => { scheduled.push(task); return 0 as unknown as ReturnType<typeof setTimeout>; },
    cancelTimer: () => {},
    onEnd: () => { counters.ends++; },
    pollMs: 200,
    timeoutMs: 90_000,
    progressBase: 0.2,
    progressSpan: 0.72,
  };
  return { options, scheduled, progress, counters };
}

const flush = async (): Promise<void> => { await Bun.sleep(0); };

test('boot watch maps progress, waits, and stops at the first screen', async () => {
  const testFixture = fixture([{ p: 0.5, label: 'Cargando' }, { screen: true }]);
  const watch = startBootWatch(testFixture.options);
  await flush();
  expect(testFixture.progress).toEqual([{ progress: 0.56, label: 'Cargando' }]);
  expect(testFixture.scheduled).toHaveLength(1);
  testFixture.scheduled.shift()!();
  await flush();
  expect(testFixture.counters.screens).toBe(1);
  expect(testFixture.counters.ends).toBe(1);
  expect(testFixture.scheduled).toHaveLength(0);
  watch.cancel();
});

test('boot watch reports an interactive loading screen and a timeout', async () => {
  const asks = fixture([{ asks: true }]);
  startBootWatch(asks.options);
  await flush();
  expect(asks.counters.asks).toBe(1);

  let now = 0;
  const timeout = fixture([null]);
  timeout.options.now = () => now;
  startBootWatch(timeout.options);
  await flush();
  now = 90_001;
  timeout.scheduled.shift()!();
  await flush();
  expect(timeout.counters.timeouts).toBe(1);
  expect(timeout.counters.ends).toBe(1);
});

test('boot watch ignores in-flight reads after cancellation and inactive owners', async () => {
  let resolveRead: ((value: BootObservation) => void) | undefined;
  const testFixture = fixture([]);
  testFixture.options.read = () => new Promise(resolve => { resolveRead = resolve; });
  const watch = startBootWatch(testFixture.options);
  watch.cancel();
  resolveRead!({ screen: true });
  await flush();
  expect(testFixture.counters.screens).toBe(0);
  expect(testFixture.counters.ends).toBe(1);
  expect(testFixture.progress).toEqual([]);
  expect(testFixture.scheduled).toHaveLength(0);

  const inactive = fixture([{ screen: true }], false);
  startBootWatch(inactive.options);
  await flush();
  expect(inactive.counters.screens).toBe(0);
});

test('boot watch continues after a rejected read until its owner stops', async () => {
  const testFixture = fixture([]);
  testFixture.options.read = () => Promise.reject(new Error('page not ready'));
  const watch = startBootWatch(testFixture.options);
  await flush();
  expect(testFixture.scheduled).toHaveLength(1);
  watch.cancel();
});
