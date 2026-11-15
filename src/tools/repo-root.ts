/**
 * Where this checkout is, for the development tools (src/tools, and out/tools once compiled). They never trust the
 * working directory: `bun run smoke` and a plain `node out/tools/smoke.js` both find the same package.json.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function findRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    const above = dirname(dir);
    if (above === dir) throw new Error(`No package.json above ${from}`);
    dir = above;
  }
}

/** The checkout that holds these scripts, whether they run from source or from the build. */
export const ROOT = findRoot(__dirname);

/** `version` of the root package.json: the value the installers and the updater compare against. */
export function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || typeof parsed.version !== 'string') {
    throw new Error('package.json has no string "version"');
  }
  return parsed.version;
}
