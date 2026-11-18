export type FrameProbeConfig = {
  warmupMs: number;
  durationMs: number;
  budgetMs: number;
  maxFrames: number;
};

export const FRAME_PROBE_DEFAULTS: Readonly<FrameProbeConfig> = {
  warmupMs: 2000, durationMs: 8000, budgetMs: 1000 / 60, maxFrames: 36_000,
};

export function frameProbe(config: FrameProbeConfig): string {
  return `
    const config = ${JSON.stringify(config)};
    await new Promise(resolve => setTimeout(resolve, config.warmupMs));
    return await new Promise(resolve => {
      const intervals = new Float64Array(config.maxFrames);
      let count = 0, previous, handle;
      let lostFocus = !document.hasFocus(), hidden = document.hidden;
      const tick = timestamp => {
        lostFocus ||= !document.hasFocus();
        hidden ||= document.hidden;
        if (previous !== undefined && count < intervals.length) intervals[count++] = timestamp - previous;
        previous = timestamp;
        handle = requestAnimationFrame(tick);
      };
      handle = requestAnimationFrame(tick);
      setTimeout(() => {
        cancelAnimationFrame(handle);
        resolve({ intervalsMs: Array.from(intervals.subarray(0, count)), lostFocus, hidden,
          capped: count === intervals.length, screen: { width: innerWidth, height: innerHeight, scale: devicePixelRatio } });
      }, config.durationMs);
    });
  `;
}

export function frameStats(intervals: readonly number[], budgetMs: number): Record<string, number> {
  assertIntervals(intervals);
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) throw new Error('Frame budget must be positive');
  const sorted = [...intervals].sort((left, right) => left - right);
  const percentile = (fraction: number): number => sorted[Math.ceil(sorted.length * fraction) - 1];
  const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
  const variance = intervals.reduce((sum, value) => sum + (value - mean) ** 2, 0) / intervals.length;
  const variation = intervals.slice(1).reduce((sum, value, index) => sum + Math.abs(value - intervals[index]), 0);
  return {
    count: intervals.length, meanMs: mean, medianMs: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99),
    stddevMs: Math.sqrt(variance), consecutiveVariationMs: intervals.length === 1 ? 0 : variation / (intervals.length - 1),
    overBudget: intervals.filter(value => value > budgetMs * 1.5).length,
    over50Ms: intervals.filter(value => value > 50).length, averageFps: 1000 / mean,
  };
}

export type FrameSpike = { atMs: number; ms: number };

/** Intervals above `thresholdMs`, with the capture time at which each one starts. */
export function frameSpikes(intervals: readonly number[], thresholdMs: number): FrameSpike[] {
  assertIntervals(intervals);
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) throw new Error('Frame spike threshold must be positive');
  const spikes: FrameSpike[] = [];
  let elapsedMs = 0;
  for (const ms of intervals) {
    if (ms > thresholdMs) spikes.push({ atMs: Math.round(elapsedMs), ms: Math.round(ms * 10) / 10 });
    elapsedMs += ms;
  }
  return spikes;
}

function assertIntervals(intervals: readonly number[]): void {
  if (intervals.length === 0 || intervals.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('Frame intervals must be a nonempty list of positive finite numbers');
  }
}
