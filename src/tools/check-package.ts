/**
 * `bun run verify:package`: inspects a packaged app.asar. Every application module a launch needs must be there, each page
 * must load a script that is really inside the package, version and client.json must match this checkout, and no
 * diagnostic output may ship.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { record } from './json';
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

const { listPackage, extractFile } = asarTools();

/**
 * The loading and offline pages run their compiled script (src/pages) through `<script src>`: an inline script could not
 * run under their `script-src file:`, and a wrong relative path would leave the page blank without any error.
 */
function checkPages(archive: string, paths: string[]): void {
  for (const page of ['offline.html', 'splash.html']) {
    const html = extractFile(archive, normalize(join('static', page))).toString();
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/, `${page} still has an inline script`);
    const sources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(sources.length > 0, `${page} loads no script`);
    for (const source of sources) {
      const inside = '/' + normalize(join('static', source)).split(sep).join('/');
      assert.ok(paths.includes(inside), `${page} loads ${source}, which is not in the package`);
    }
  }
}

// Relative arguments resolve against the checkout, not the shell's working directory.
const argument = process.argv[2] ?? join('release', 'win-unpacked', 'resources', 'app.asar');
const archive = isAbsolute(argument) ? argument : resolve(ROOT, argument);
const paths = listPackage(archive).map((path) => path.split(sep).join('/'));
const entrypoints = ['main', 'preload', 'discord', 'updater', 'text'].map((name) => `/out/${name}.js`);
// The flat src/ modules the entrypoints import; nothing else may ship under out/.
const modules = ['bridge', 'coalesced-task', 'config', 'discord-frames', 'distribution', 'navigation', 'settings', 'window-state']
  .map((name) => `/out/${name}.js`);
// The loading and offline pages' scripts (src/pages).
const pageScripts = /^[/]out[/]pages[/][^/]+[.]js$/;
for (const path of paths.filter((path) => path.startsWith('/out/') && path.endsWith('.js'))) {
  assert.ok(entrypoints.includes(path) || modules.includes(path) || pageScripts.test(path), `Unexpected application script: ${path}`);
}
const required = [...entrypoints, ...modules, '/out/pages/offline.js', '/out/pages/splash.js', '/client.json'];
for (const path of required) {
  assert.ok(extractFile(archive, normalize(path.slice(1))).length, `Missing module: ${path}`);
}
checkPages(archive, paths);
assert.equal(paths.some((path) => /^[/](tests|src)[/]/.test(path) || /[/]out[/].*(smoke-|selftest|live-probe|[.]zip$)/.test(path)), false, 'Diagnostics must not ship');
const pkg = record(JSON.parse(extractFile(archive, 'package.json').toString()), 'packaged package.json');
assert.equal(pkg.version, packageVersion());
const config = record(JSON.parse(extractFile(archive, 'client.json').toString()), 'packaged client.json');
assert.deepEqual(config, record(JSON.parse(readFileSync(join(ROOT, 'client.json'), 'utf8')), 'client.json'));
console.log(`Packaged modules, pages, version and diagnostic exclusion PASS: ${archive}`);
