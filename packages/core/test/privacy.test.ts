import { describe, expect, it } from 'vitest';
import { stripIp } from '../src/privacy.js';

describe('stripIp', () => {
  it('removes user.ip_address, {{auto}}, REMOTE_ADDR and forwarding headers', () => {
    const event = stripIp({
      user: { id: '1', ip_address: '203.0.113.9' },
      request: {
        env: { REMOTE_ADDR: '203.0.113.9', OTHER: 'x' },
        headers: {
          'X-Forwarded-For': '203.0.113.9',
          'x-real-ip': 'a',
          forwarded: 'b',
          'cf-connecting-ip': 'c',
          'true-client-ip': 'd',
          'x-client-ip': 'e',
          accept: 'json',
        },
      },
      extra: { list: ['{{auto}}', 'keep', { deep: '{{auto}}' }], v: '{{auto}}' },
    });
    expect(event.user).toEqual({ id: '1' });
    expect(event.request).toEqual({ env: { OTHER: 'x' }, headers: { accept: 'json' } });
    expect(event.extra).toEqual({ list: ['keep', {}] });
  });

  it('handles events without user or request', () => {
    expect(stripIp({ user: { ip_address: '{{auto}}' } })).toEqual({ user: {} });
    expect(stripIp({ request: {} })).toEqual({ request: {} });
    expect(stripIp({})).toEqual({});
  });

  it('stops at depth 20', () => {
    let deep: Record<string, unknown> = { v: '{{auto}}' };
    for (let i = 0; i < 25; i++) deep = { n: deep };
    expect(JSON.stringify(stripIp({ extra: deep }))).toContain('{{auto}}');
  });
});
