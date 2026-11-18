import { encodeFrame } from '../discord-frames';

type BufferMethods = {
  alloc: (size: number) => Buffer;
  allocUnsafe: (size: number) => Buffer;
  from: (...args: unknown[]) => Buffer;
  concat: (...args: unknown[]) => Buffer;
};

type Counters = { allocations: number; allocatedBytes: number; copiedBytes: number };

const ITERATIONS = { warmup: 2_000, measured: 20_000 } as const;
const payload = {
  cmd: 'SET_ACTIVITY',
  args: {
    pid: 12345,
    activity: {
      type: 0, details: 'Route 1 · Pikachu', state: 'Survival · 12:34',
      timestamps: { start: 1_700_000_000_000 },
      assets: { large_image: 'https://pokebonk.com/assets/ui/desktop/app.png', large_text: 'PokéBonk' },
    },
  },
  nonce: '1700000000000-a1b2c3d4e5f6',
} as const;

function previousEncode(op: number, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function instrument(run: () => void): { counters: Counters; elapsedMs: number } {
  const counters: Counters = { allocations: 0, allocatedBytes: 0, copiedBytes: 0 };
  const original = {
    alloc: Buffer.alloc, allocUnsafe: Buffer.allocUnsafe, from: Buffer.from, concat: Buffer.concat,
  } as BufferMethods;
  const mutable = Buffer as unknown as BufferMethods;
  mutable.alloc = (size) => {
    counters.allocations++;
    counters.allocatedBytes += size;
    return original.alloc(size);
  };
  mutable.allocUnsafe = (size) => {
    counters.allocations++;
    counters.allocatedBytes += size;
    return original.allocUnsafe(size);
  };
  mutable.from = (...args) => {
    const source = args[0];
    const bytes = typeof source === 'string' ? Buffer.byteLength(source) : source instanceof Uint8Array ? source.byteLength : 0;
    counters.allocations++;
    counters.allocatedBytes += bytes;
    return original.from.apply(undefined, args);
  };
  mutable.concat = (...args) => {
    const chunks = args[0] as readonly Uint8Array[];
    counters.allocations++;
    counters.allocatedBytes += chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    counters.copiedBytes += chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    return original.concat.apply(undefined, args);
  };
  const start = performance.now();
  try { run(); } finally {
    mutable.allocUnsafe = original.allocUnsafe;
    mutable.alloc = original.alloc;
    mutable.from = original.from;
    mutable.concat = original.concat;
  }
  return { counters, elapsedMs: performance.now() - start };
}

function measure(encode: (op: number, data: unknown) => Buffer): { counters: Counters; elapsedMs: number; totalBytes: number } {
  let totalBytes = 0;
  for (let index = 0; index < ITERATIONS.warmup; index++) totalBytes += encode(1, payload).length;
  const result = instrument(() => {
    for (let index = 0; index < ITERATIONS.measured; index++) totalBytes += encode(1, payload).length;
  });
  return { ...result, totalBytes };
}

const baseline = measure(previousEncode);
const candidate = measure(encodeFrame);
if (!previousEncode(1, payload).equals(encodeFrame(1, payload))) throw new Error('Encoded bytes differ');
const report = {
  iterations: ITERATIONS.measured,
  baseline: { ...baseline, allocationsPerFrame: baseline.counters.allocations / ITERATIONS.measured },
  candidate: { ...candidate, allocationsPerFrame: candidate.counters.allocations / ITERATIONS.measured },
  allocationReductionPercent: Number((100 * (1 - candidate.counters.allocations / baseline.counters.allocations)).toFixed(1)),
  allocatedByteReductionPercent: Number((100 * (1 - candidate.counters.allocatedBytes / baseline.counters.allocatedBytes)).toFixed(1)),
  concatCopyReductionPercent: Number((100 * (1 - candidate.counters.copiedBytes / baseline.counters.copiedBytes)).toFixed(1)),
  node: process.version, platform: process.platform,
};
console.log(JSON.stringify(report, null, 2));
