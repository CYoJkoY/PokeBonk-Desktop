/** Framework-independent, backwards-compatible client settings schema. */
export type Angle = 'auto' | 'd3d11' | 'gl' | 'vulkan' | 'metal';
export type ClientCfg = { vsync: boolean; angle: Angle; lastArt?: string; discord: boolean };
export const DEFAULT_CONFIG: Readonly<ClientCfg> = { vsync: true, angle: 'auto', discord: true };
export const SPLASH_ART = ['forest', 'coast', 'glacier', 'desert', 'horde'] as const;
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export function anglesFor(platform: string): Angle[] {
  return platform === 'win32' ? ['auto', 'd3d11', 'gl', 'vulkan'] : platform === 'darwin' ? ['auto', 'metal', 'gl'] : ['auto', 'gl', 'vulkan'];
}
export function parseConfig(value: unknown, angles: readonly Angle[]): ClientCfg {
  const v = isRecord(value) ? value : {};
  return {
    vsync: typeof v.vsync === 'boolean' ? v.vsync : DEFAULT_CONFIG.vsync,
    discord: typeof v.discord === 'boolean' ? v.discord : DEFAULT_CONFIG.discord,
    angle: angles.includes(v.angle as Angle) ? v.angle as Angle : 'auto',
    ...(SPLASH_ART.some(a => a === v.lastArt) ? { lastArt: v.lastArt as string } : {}),
  };
}
export type DisplayPatch = { mode?: 'fullscreen' | 'window'; size?: string; monitor?: number; vsync?: boolean; angle?: Angle; discord?: boolean };
/** Validate the entire request before performing any side effects. */
export function parseDisplayPatch(value: unknown, angles: readonly Angle[]): DisplayPatch {
  if (!isRecord(value)) throw new Error('Display settings must be an object');
  const p: DisplayPatch = {};
  for (const [key, v] of Object.entries(value)) {
    if (v === undefined) continue;
    switch (key) {
      case 'mode':
        if (v !== 'fullscreen' && v !== 'window') throw new Error('Invalid display mode');
        p.mode = v; break;
      case 'size': {
        if (typeof v !== 'string') throw new Error('Invalid display size');
        if (v !== 'max') {
          const match = /^(\d{3,4})x(\d{3,4})$/.exec(v);
          if (!match || +match[1] < 960 || +match[2] < 540 || +match[1] > 7680 || +match[2] > 4320) throw new Error('Invalid display size');
        }
        p.size = v; break;
      }
      case 'monitor':
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('Invalid display monitor');
        p.monitor = v; break;
      case 'vsync': case 'discord':
        if (typeof v !== 'boolean') throw new Error(`Invalid ${key} setting`);
        p[key] = v; break;
      case 'angle':
        if (!angles.includes(v as Angle)) throw new Error('Invalid graphics backend');
        p.angle = v as Angle; break;
      default: throw new Error(`Unknown display setting: ${key}`);
    }
  }
  return p;
}
