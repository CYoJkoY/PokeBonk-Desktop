import { createRequire } from 'node:module';
import { normalize, sep } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { listPackage, extractFile } = require('@electron/asar');
const archive = process.argv[2] ?? 'release/win-unpacked/resources/app.asar';
const paths = listPackage(archive).map(path => path.split(sep).join('/'));
const entrypoints = ['main', 'preload', 'discord', 'updater', 'text'].map(name => '/out/' + name + '.js');
const modules = /^[/]out[/](domain|adapters|ports)[/][^/]+[.]js$/;
for (const path of paths.filter(path => path.startsWith('/out/') && path.endsWith('.js'))) {
  assert.ok(entrypoints.includes(path) || modules.test(path), 'Unexpected application script: ' + path);
}
for (const path of entrypoints.concat(['/out/domain/navigation.js', '/out/adapters/bridge.js',
  '/out/adapters/discord-frames.js', '/out/adapters/coalesced-task.js', '/client.json'])) {
  assert.ok(extractFile(archive, normalize(path.slice(1))).length, 'Missing module: ' + path);
}
assert.equal(paths.some(path => /^[/](tests|scripts)[/]/.test(path) || /[/]out[/].*(smoke-|selftest|live-probe|[.]zip$)/.test(path)), false, 'Diagnostics must not ship');
const pkg = JSON.parse(extractFile(archive, 'package.json').toString());
assert.equal(pkg.version, require('../package.json').version);
const config = JSON.parse(extractFile(archive, 'client.json').toString());
assert.deepEqual(config, require('../client.json'));
console.log('Packaged modules, version and diagnostic exclusion PASS: ' + archive);
