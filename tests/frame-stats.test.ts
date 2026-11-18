import { expect, test } from 'bun:test';
import { frameSpikes, frameStats } from '../src/tools/frame-probe';

test('frame statistics preserve order for variation and use nearest-rank percentiles', () => {
  const stats = frameStats([10, 40, 10, 20], 10);
  expect(stats.medianMs).toBe(10);
  expect(stats.p95Ms).toBe(40);
  expect(stats.p99Ms).toBe(40);
  expect(stats.meanMs).toBe(20);
  expect(stats.stddevMs).toBeCloseTo(Math.sqrt(150));
  expect(stats.consecutiveVariationMs).toBeCloseTo(70 / 3);
  expect(stats.overBudget).toBe(2);
  expect(stats.averageFps).toBe(50);
});

test('stable frames have no variation and sparse long frames are counted', () => {
  expect(frameStats([16, 16, 16], 1000 / 60).consecutiveVariationMs).toBe(0);
  expect(frameStats([16], 1000 / 60).stddevMs).toBe(0);
  expect(frameStats([16, 100, 16], 1000 / 60).over50Ms).toBe(1);
});

test('frame statistics reject missing samples, invalid deltas and invalid budgets', () => {
  for (const intervals of [[], [0], [-1], [NaN], [Infinity]]) expect(() => frameStats(intervals, 16)).toThrow();
  for (const budget of [0, -1, NaN, Infinity]) expect(() => frameStats([16], budget)).toThrow();
});

test('long frames report the capture time where each spike starts', () => {
  expect(frameSpikes([16, 16, 120.44, 16, 61], 50)).toEqual([
    { atMs: 32, ms: 120.4 }, { atMs: 168, ms: 61 },
  ]);
  expect(frameSpikes([16, 16, 16], 50)).toEqual([]);
});

test('long frame reporting rejects the same invalid samples as the statistics', () => {
  for (const intervals of [[], [0], [-1], [NaN], [Infinity]]) expect(() => frameSpikes(intervals, 50)).toThrow();
  for (const threshold of [0, -1, NaN, Infinity]) expect(() => frameSpikes([16], threshold)).toThrow();
});
