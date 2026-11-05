import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeEnvelope, serializeLine } from '../src/envelope.js';

const utf8 = new TextEncoder();

describe('envelope encoder', () => {
  it('encodes header, item header with exact length, and payload', () => {
    const payload = serializeLine({ message: 'héllo 😀' });
    const body = encodeEnvelope({ event_id: 'a' }, [{ type: 'event', payload }]);
    const lines = body.split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[1]!)).toEqual({ type: 'event', length: utf8.encode(payload).length });
    expect(body.endsWith('\n')).toBe(false);
  });

  it('throws on a raw newline in a payload line', () => {
    expect(() => encodeEnvelope({}, [{ type: 'event', payload: '{"a":"\n"}' }])).toThrow(
      /raw newline/,
    );
    expect(() => encodeEnvelope({}, [{ type: 'event', payload: '{"a":"\r"}' }])).toThrow(
      /raw newline/,
    );
  });

  it('replaces lone surrogates in keys and values', () => {
    expect(serializeLine({ 'k\uD800': 'v\uDC00', ok: ['x'] })).toBe(
      '{"k\uFFFD":"v\uFFFD","ok":["x"]}',
    );
  });

  it('never emits a raw newline and always an exact length (property)', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme' }), (a, b) => {
        const payload = serializeLine({ message: a, extra: { b, [a]: b } });
        const body = encodeEnvelope({ event_id: 'x' }, [{ type: 'event', payload }]);
        const lines = body.split('\n');
        expect(lines).toHaveLength(3);
        const header = JSON.parse(lines[1]!) as { length: number };
        expect(header.length).toBe(utf8.encode(lines[2]!).length);
        const decoded = JSON.parse(lines[2]!) as { message: string };
        expect(decoded.message).toBe(
          a.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�'),
        );
        expect(lines[2]).not.toMatch(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i);
      }),
      { numRuns: 500 },
    );
  });
});
