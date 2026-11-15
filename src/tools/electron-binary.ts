/**
 * The Electron this checkout installed: the package exports the executable path of its own download, not an API, so a
 * plain require keeps the declared types of the Electron API out of the way.
 */
export function electronBinary(): string {
  const binary: unknown = require('electron');
  if (typeof binary !== 'string') throw new Error('The electron package did not resolve to an executable path');
  return binary;
}
