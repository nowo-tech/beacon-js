import { describe, expect, it } from 'vitest';
import {
  defaultScrubber,
  FILTERED,
  maskCredentials,
  scrubHeaders,
  scrubObject,
  scrubUrl,
} from '../src/scrub.js';

describe('scrubber', () => {
  it.each([
    'password',
    'passwd',
    'pass',
    'client_secret',
    'access_token',
    'apiKey',
    'api-key',
    'API_KEY',
    'authorization',
    'credentials',
    'sessionId',
    'cookie',
    'csrf',
    'xsrf_token',
    'private_key',
    'privateKey',
    'card_number',
    'cvv',
    'iban',
    'ssn',
  ])('filters key %s', (key) => {
    expect(scrubObject({ [key]: 'v', keep: 'k' })).toEqual({ [key]: FILTERED, keep: 'k' });
  });

  it('walks arrays and stops at depth', () => {
    expect(scrubObject([{ token: 1 }])).toEqual([{ token: FILTERED }]);
    expect(scrubObject({ a: { token: 1 } }, 1)).toEqual({ a: { token: 1 } });
    expect(scrubObject('x')).toBe('x');
  });

  it.each([
    'authorization',
    'Proxy-Authorization',
    'cookie',
    'set-cookie',
    'x-beacon-auth',
    'x-api-key',
    'x-auth-token',
    'x-csrf-token',
    'x-xsrf-token',
  ])('filters header %s', (name) => {
    expect(scrubHeaders({ [name]: 'v', accept: 'a' })).toEqual({ [name]: FILTERED, accept: 'a' });
  });

  it('filters sensitive query values and drops fragments', () => {
    expect(
      scrubUrl(
        'https://a.test/p?code=1&state=2&q=ok&access_token=3&id_token=4&refresh_token=5&sig=6&signature=7&password=8#frag',
      ),
    ).toBe(
      `https://a.test/p?code=${FILTERED}&state=${FILTERED}&q=ok&access_token=${FILTERED}&id_token=${FILTERED}&refresh_token=${FILTERED}&sig=${FILTERED}&signature=${FILTERED}&password=${FILTERED}`,
    );
    expect(scrubUrl('/p#x')).toBe('/p');
    expect(scrubUrl('/p?%E0%A4%A=1&flag')).toBe('/p?%E0%A4%A=1&flag');
    expect(scrubUrl('/p?api%5Fkey=1')).toBe(`/p?api%5Fkey=${FILTERED}`);
  });

  it('masks credential-like values', () => {
    expect(maskCredentials('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig-123 end')).toBe(
      `jwt ${FILTERED} end`,
    );
    expect(maskCredentials('Authorization: Bearer abc.def-123==')).toBe(
      `Authorization: Bearer ${FILTERED}`,
    );
    expect(maskCredentials('key bk_live_abc123 here')).toBe(`key ${FILTERED} here`);
    expect(maskCredentials('hex 0123456789abcdef0123456789abcdef')).toBe(`hex ${FILTERED}`);
    expect(maskCredentials('id averyveryverylongidentifiernamewithoutdigits')).toBe(
      'id averyveryverylongidentifiernamewithoutdigits',
    );
    expect(maskCredentials('n 01234567890123456789012345678901234')).toBe(
      'n 01234567890123456789012345678901234',
    );
  });

  it('scrubs an event without mutating the input', () => {
    const event = {
      message: 'token bk_abc',
      exception: { values: [{ type: 'E', value: 'Bearer xyz' }] },
      request: {
        url: 'https://a.test/?token=1#f',
        query_string: 'token=1&x=2',
        headers: { Authorization: 'Bearer x', Accept: 'json' },
        cookies: 'a=b',
        data: { password: 'p', ok: 1 },
      },
      extra: { secret: 's', fine: 'f' },
      contexts: { app: { api_key: 'k' } },
      tags: { session: 's', env: 'e' },
      breadcrumbs: {
        values: [
          {
            message: 'Bearer abc',
            data: {
              url: '/x?code=1',
              from: '/a#b',
              to: '/b?state=s',
              note: 'bk_key',
              n: 1,
              auth: 'x',
            },
          },
          { category: 'plain' },
        ],
      },
    };
    const copy = structuredClone(event);
    const out = defaultScrubber(event);
    expect(event).toEqual(copy);
    expect(out.message).toBe(`token ${FILTERED}`);
    expect(out.exception!.values[0]!.value).toBe(`Bearer ${FILTERED}`);
    expect(out.request).toEqual({
      url: `https://a.test/?token=${FILTERED}`,
      query_string: `token=${FILTERED}&x=2`,
      headers: { Authorization: FILTERED, Accept: 'json' },
      cookies: FILTERED,
      data: { password: FILTERED, ok: 1 },
    });
    expect(out.extra).toEqual({ secret: FILTERED, fine: 'f' });
    expect(out.contexts).toEqual({ app: { api_key: FILTERED } });
    expect(out.tags).toEqual({ session: FILTERED, env: 'e' });
    expect(out.breadcrumbs!.values[0]).toEqual({
      message: `Bearer ${FILTERED}`,
      data: {
        url: `/x?code=${FILTERED}`,
        from: '/a',
        to: `/b?state=${FILTERED}`,
        note: FILTERED,
        n: 1,
        auth: FILTERED,
      },
    });
    expect(out.breadcrumbs!.values[1]).toEqual({ category: 'plain' });
    expect(defaultScrubber({ request: {} }).request).toEqual({});
    expect(defaultScrubber({})).toEqual({});
  });

  it('strips URL userinfo and credential-looking values under any name', () => {
    expect(scrubUrl('https://alice:hunter2@api.test/x?q=1')).toBe('https://api.test/x?q=1');
    expect(scrubUrl('https://alice@api.test/')).toBe('https://api.test/');
    expect(scrubUrl('/x?q=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln&page=2')).toBe(
      `/x?q=${FILTERED}&page=2`,
    );
    expect(scrubUrl('/x?k=sk_fake_abcdefgh1234&v=%E0%A4%A')).toBe(`/x?k=${FILTERED}&v=%E0%A4%A`);
    expect(scrubUrl('mailto:a@b.test')).toBe('mailto:a@b.test');
  });

  it('masks prefixed keys and Luhn-valid card numbers, not timestamps', () => {
    expect(maskCredentials('key sk_fake_abcdefgh1234 pk_test_00000000 ghp_abcdefghij')).toBe(
      `key ${FILTERED} ${FILTERED} ${FILTERED}`,
    );
    expect(
      maskCredentials('card 4111 1111 1111 1111 or 4111-1111-1111-1111 or 4111111111111111'),
    ).toBe(`card ${FILTERED} or ${FILTERED} or ${FILTERED}`);
    expect(maskCredentials('at 1730800000123 id 4111111111111112')).toBe(
      'at 1730800000123 id 4111111111111112',
    );
  });
});
