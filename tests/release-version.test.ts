import { describe, expect, test } from 'bun:test';
import { validateReleaseTag } from '../scripts/check-release-version.mjs';

describe('release tag validation', () => {
  test('accepts a matching v-prefixed three-part version', () => {
    expect(validateReleaseTag('v1.2.3', '1.2.3')).toBe('1.2.3');
  });

  test.each(['1.2.3', 'v1.2', 'v1.2.3-beta.1', 'v01.2.3', 'v1.2.3.4'])('rejects malformed tag %s', tag => {
    expect(() => validateReleaseTag(tag, '1.2.3')).toThrow();
  });

  test('rejects a valid tag when its version differs from the package', () => {
    expect(() => validateReleaseTag('v1.2.3', '1.2.4')).toThrow(/does not match package.json version/);
  });
});
