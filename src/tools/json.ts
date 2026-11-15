/**
 * JSON that the client wrote and a diagnostic script reads back: `unknown` until it is narrowed here, with the file or
 * key named in the error. The scripts share this instead of three copies of the same guard.
 */
import { readFileSync } from 'node:fs';
import { isRecord } from '../config';

/** `value` as a JSON object, or an error that says what was expected to be one. */
export function record(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${what} is not an object`);
  return value;
}

/** The same, read from a diagnostic file. */
export function readJson(file: string, what: string): Record<string, unknown> {
  return record(JSON.parse(readFileSync(file, 'utf8')), what);
}
