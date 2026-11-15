/**
 * `bun run sync:repo -- <checkout of pokebonk-app>` (docs/RUNTIME.md): copies this client's sources
 * into that checkout, where GitHub Actions builds the three systems. Its README.md stays as it is.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './repo-root';

const destination = process.argv[2];
if (!destination || !existsSync(join(destination, '.git'))) {
  console.error('Usage: bun run sync:repo -- <checkout of pokebonk-app>');
  process.exit(1);
}
const items = ['src', 'static', 'build', '.github', 'tests', 'docs', '.gitignore', 'package.json', 'package-lock.json',
  'bun.lock', 'client.json', 'tsconfig.json', 'tsconfig.renderer.json', 'electron-builder.yml'];
for (const item of items) {
  rmSync(join(destination, item), { recursive: true, force: true });
  cpSync(join(ROOT, item), join(destination, item), { recursive: true });
}
// Files an earlier sync left behind that this checkout no longer has (1.5.4 moved every script to TypeScript and the
// PowerShell helper now lives in src/tools).
for (const obsolete of ['sync-repo.mjs', 'scripts']) rmSync(join(destination, obsolete), { recursive: true, force: true });
console.log(`Copied ${items.length} items to ${destination}`);
