export type BootObservation = {
  screen?: boolean;
  asks?: boolean;
  p?: number;
  label?: string;
};

export type BootWatchOptions = {
  read: () => Promise<BootObservation | null>;
  isActive: () => boolean;
  onProgress: (progress: number, label: string | undefined) => void;
  onScreen: () => void;
  onAsks: () => void;
  onTimeout: () => void;
  now: () => number;
  schedule: (task: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelTimer: (timer: ReturnType<typeof setTimeout>) => void;
  onEnd: () => void;
  pollMs: number;
  timeoutMs: number;
  progressBase: number;
  progressSpan: number;
};

export type BootWatch = { cancel: () => void };

/** Polls the game's boot DOM with one cancellable owner; stale reads cannot emit after cancellation. */
export function startBootWatch(options: BootWatchOptions): BootWatch {
  let active = true;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const since = options.now();

  const stop = (): void => {
    if (!active) return;
    active = false;
    generation++;
    options.onEnd();
    if (timer !== undefined) {
      options.cancelTimer(timer);
      timer = undefined;
    }
  };

  const tick = async (): Promise<void> => {
    if (!active || !options.isActive()) {
      stop();
      return;
    }
    const current = generation;
    let observation: BootObservation | null = null;
    try {
      observation = await options.read();
    } catch {
      observation = null;
    }
    if (!active || current !== generation || !options.isActive()) return;
    if (observation?.screen) {
      options.onScreen();
      stop();
      return;
    }
    if (observation?.asks) {
      options.onAsks();
      stop();
      return;
    }
    if (observation?.p !== undefined) {
      options.onProgress(options.progressBase + options.progressSpan * observation.p, observation.label);
    }
    if (options.now() - since > options.timeoutMs) {
      options.onTimeout();
      stop();
      return;
    }
    timer = options.schedule(() => { void tick(); }, options.pollMs);
  };

  void tick();
  return { cancel: stop };
}
