/**
 * `bun run verify:package`: inspects a packaged app.asar. Every application module a launch needs must be there, version
 * and client.json must match this checkout, and no diagnostic output may ship.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { isRecord } from '../domain/config';
import { packageVersion, ROOT } from './repo-root';

type AsarTools = { listPackage: (archive: string) => string[]; extractFile: (archive: string, file: string) => Buffer };

function asarTools(): AsarTools {
  // electron-builder's own dependency: the application never imports it.
  const tools = require('@electron/asar') as { listPackage?: AsarTools['listPackage']; extractFile?: AsarTools['extractFile'] };
  if (typeof tools.listPackage !== 'function' || typeof tools.extractFile !== 'function') {
    throw new Error('@electron/asar does not provide listPackage/extractFile');
  }
  return { listPackage: tools.listPackage, extractFile: tools.extractFile };
}

function jsonRecord(text: string, what: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) throw new Error(`${what} is not a JSON object`);
  return parsed;
}

const { listPackage, extractFile } = asarTools();
// Relative arguments resolve against the checkout, not the shell's working directory.
const argument = process.argv[2] ?? join('release', 'win-unpacked', 'resources', 'app.asar');
const archive = isAbsolute(argument) ? argument : resolve(ROOT, argument);
const paths = listPackage(archive).map((path) => path.split(sep).join('/'));
const entrypoints = ['main', 'preload', 'discord', 'updater', 'text'].map((name) => `/out/${name}.js`);
const modules = /^[/]out[/](domain|adapters|ports)[/][^/]+[.]js$/;
// The loading and offline pages' scripts (src/renderer).
const pageScripts = /^[/]out[/]renderer[/][^/]+[.]js$/;
for (const path of paths.filter((path) => path.startsWith('/out/') && path.endsWith('.js'))) {
  assert.ok(entrypoints.includes(path) || modules.test(path) || pageScripts.test(path), `Unexpected application script: ${path}`);
}
const required = [...entrypoints, '/out/domain/navigation.js', '/out/adapters/bridge.js', '/out/adapters/discord-frames.js',
  '/out/adapters/coalesced-task.js', '/out/renderer/offline.js', '/out/renderer/splash.js', '/client.json'];
for (const path of required) {
  assert.ok(extractFile(archive, normalize(path.slice(1))).length, `Missing module: ${path}`);
}
assert.equal(paths.some((path) => /^[/](tests|scripts)[/]/.test(path) || /[/]out[/].*(smoke-|selftest|live-probe|[.]zip$)/.test(path)), false, 'Diagnostics must not ship');
const pkg = jsonRecord(extractFile(archive, 'package.json').toString(), 'packaged package.json');
assert.equal(pkg.version, packageVersion());
const config = jsonRecord(extractFile(archive, 'client.json').toString(), 'packaged client.json');
assert.deepEqual(config, jsonRecord(readFileSync(join(ROOT, 'client.json'), 'utf8'), 'client.json'));
console.log(`Packaged modules, version and diagnostic exclusion PASS: ${archive}`);
