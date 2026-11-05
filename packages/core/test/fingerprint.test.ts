import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { exceptionsFromError } from '../src/exception.js';
import { expandFingerprint, groupingInputs, normalizeGroupingValue } from '../src/fingerprint.js';
import { normalizeUrlFilename } from '../src/stack.js';
import type { BeaconEvent } from '../src/types.js';

/** A port of Beacon's FingerprintCalculator (contract §0.5) with the spec 172 filename normalisation. */
function beaconFingerprint(event: BeaconEvent): string {
  const sha = (text: string) => createHash('sha256').update(text).digest('hex');
  if (event.fingerprint?.length) return sha(event.fingerprint.join('|'));
  const values = event.exception?.values ?? [];
  const last = values[values.length - 1]!;
  const frames = last.stacktrace?.frames ?? [];
  const frame = [...frames].reverse().find((f) => f.in_app) ?? frames[frames.length - 1];
  const file = (frame?.filename ?? '')
    .replace(/[?#].*$/, '')
    .replace(/[-.][0-9a-f]{8,}(?=\.m?js$)/i, '');
  const match = /(?:^|\/)((?:src|app|tests)\/.*)$/.exec(file);
  const normalisedFile = match ? match[1] : file.split('/').pop();
  return sha(
    [last.type, normalizeGroupingValue(last.value), normalisedFile, frame?.function ?? ''].join(
      '|',
    ),
  );
}

function eventFor(stack: string): BeaconEvent {
  const error = new TypeError('Cannot read 12 of user 0123456789abcdef0123456789abcdef');
  error.stack = stack;
  const result = exceptionsFromError(
    error,
    { type: 'onerror' },
    { normalizeFilename: normalizeUrlFilename },
  );
  return { exception: { values: result.values } };
}

describe('fingerprint', () => {
  it('normalises values like Beacon', () => {
    expect(
      normalizeGroupingValue(
        'id 0b0f7c1e-1111-4111-8111-111111111111 hex 0123456789abcdef0123456789abcdef n 42  x',
      ),
    ).toBe('id <uuid> hex <hex> n <n> x');
  });

  it('gives two builds with different content hashes the same Beacon fingerprint', () => {
    const a = eventFor(
      'TypeError: x\n    at render (https://app.test/assets/index-3f9a1c2b.js?v=1:10:5)',
    );
    const b = eventFor(
      'TypeError: x\n    at render (https://cdn.test/assets/index-9e8d7c6b.js:99:1)',
    );
    expect(beaconFingerprint(a)).toBe(beaconFingerprint(b));
    expect(groupingInputs(a)).toEqual({
      type: 'TypeError',
      value_normalised: 'Cannot read <n> of user <hex>',
      filename: '/assets/index.js',
      function: 'render',
    });
  });

  it('falls back to the last frame, the message, and empty inputs', () => {
    const event = eventFor('TypeError: x\n    at lib (/app/node_modules/lib.js:1:1)');
    expect(groupingInputs(event).filename).toBe('/app/node_modules/lib.js');
    expect(groupingInputs({ message: 'Order 42 failed' })).toEqual({
      type: '',
      value_normalised: 'Order <n> failed',
      filename: '',
      function: '',
    });
    expect(groupingInputs({})).toEqual({
      type: '',
      value_normalised: '',
      filename: '',
      function: '',
    });
  });

  it('expands {{ default }} client-side', () => {
    const event = eventFor(
      'TypeError: x\n    at render (https://app.test/assets/index-3f9a1c2b.js:10:5)',
    );
    event.fingerprint = ['checkout', '{{ default }}'];
    expect(expandFingerprint(event).fingerprint).toEqual([
      'checkout',
      'TypeError',
      'Cannot read <n> of user <hex>',
      '/assets/index.js:render',
    ]);
    const plain = { fingerprint: ['a'] };
    expect(expandFingerprint(plain).fingerprint).toEqual(['a']);
    expect(expandFingerprint({ message: 'm' })).toEqual({ message: 'm' });
    expect(expandFingerprint({ fingerprint: ['{{default}}'] }).fingerprint).toEqual(['', '', ':']);
  });
});
