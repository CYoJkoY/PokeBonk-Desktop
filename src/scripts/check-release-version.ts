/**
 * Release workflow gate: a `vX.Y.Z` tag must match the version the installers are built with, so a mistyped tag never
 * publishes binaries under a version players do not run.
 */
import { packageVersion } from './repo-root';

export function validateReleaseTag(tag: string | undefined, version: string): string {
  const match = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(tag ?? '');
  if (!match) throw new Error(`Invalid release tag "${tag ?? ''}". Expected vX.Y.Z with numeric components and no leading zeroes.`);

  const tagVersion = match.slice(1).join('.');
  if (tagVersion !== version) throw new Error(`Release tag ${tag} does not match package.json version ${version}.`);
  return tagVersion;
}

// `node out/scripts/check-release-version.js <tag>`: importing it (tests/release-version.test.ts) validates nothing.
if (require.main === module) {
  try {
    const version = packageVersion();
    validateReleaseTag(process.argv[2], version);
    console.log(`Release tag ${process.argv[2]} matches package.json version ${version}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
