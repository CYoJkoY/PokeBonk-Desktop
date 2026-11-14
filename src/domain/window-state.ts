import { isRecord } from './config';
export type WinState = { x?: number; y?: number; width: number; height: number; maximized?: boolean; fullscreen?: boolean };
export function parseWindowState(value: unknown): WinState {
  if (!isRecord(value)) throw new Error('Invalid window state');
  const dimension = (key: string, min: number) => {
    const v = value[key];
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > 16384) throw new Error(`Invalid window ${key}`);
    return v;
  };
  const position = (key: string) => {
    const v = value[key];
    return typeof v === 'number' && Number.isSafeInteger(v) && Math.abs(v) <= 1_000_000 ? v : undefined;
  };
  return { width: dimension('width', 960), height: dimension('height', 540), x: position('x'), y: position('y'),
    maximized: value.maximized === true, fullscreen: value.fullscreen === true };
}
