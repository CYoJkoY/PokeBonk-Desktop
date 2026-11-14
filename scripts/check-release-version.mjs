import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const tag = process.argv[2];
export function validateReleaseTag(tag, version) {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag ?? '');
  if (!match) throw new Error(`Invalid release tag "${tag ?? ''}". Expected vX.Y.Z with numeric components and no leading zeroes.`);

  const tagVersion = match.slice(1).join('.');
  if (tagVersion !== version) throw new Error(`Release tag ${tag} does not match package.json version ${version}.`);
  return tagVersion;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    validateReleaseTag(tag, version);
    console.log(`Release tag ${tag} matches package.json version ${version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
