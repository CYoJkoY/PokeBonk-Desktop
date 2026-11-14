import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseConfig, type Angle, type ClientCfg } from '../domain/config';
import type { SettingsStore } from '../ports/settings';

/** A failed write preserves the last valid file. No filesystem dependencies in the schema. */
export function fileSettings(file: string, angles: readonly Angle[], warn: (message: string, error: unknown) => void): SettingsStore {
  return {
    read() {
      try { return parseConfig(JSON.parse(readFileSync(file, 'utf8')) as unknown, angles); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') warn('Cannot read client settings; using defaults', error);
        return parseConfig(null, angles);
      }
    },
    write(patch) {
      const next: ClientCfg = parseConfig({ ...this.read(), ...patch }, angles);
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(`${file}.tmp`, JSON.stringify(next));
        renameSync(`${file}.tmp`, file);
      } catch (error) { warn('Cannot save client settings', error); }
    },
  };
}
