import { describe, expect, it } from 'vitest';
import { isClientAddressHeader, stripIp } from '../src/privacy.js';

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

  it('removes every client-IP header on common hosts and proxies, and remote_addr in any case', () => {
    const headers = Object.fromEntries(
      [
        'X-Original-Forwarded-For',
        'X-Cluster-Client-IP',
        'Fastly-Client-IP',
        'X-Vercel-Forwarded-For',
        'CF-Pseudo-IPv4',
        'CF-IPCountry',
        'X-Envoy-External-Address',
        'X-Appengine-User-Ip',
        'X-Client-IP',
        'Client-Ip',
        'Accept',
      ].map((name) => [name, '198.51.100.7']),
    );
    const event = stripIp({
      request: {
        headers,
        env: { remote_addr: '198.51.100.7', REMOTE_ADDR: 'x', Remote_Addr: 'y', PATH: '/bin' },
      },
    });
    expect(event.request!.headers).toEqual({ Accept: '198.51.100.7' });
    expect(event.request!.env).toEqual({ PATH: '/bin' });
  });

  it('treats every address-bearing header name as a client address (FVD-L1)', () => {
    for (const name of [
      'CloudFront-Viewer-Address',
      'X-Remote-Addr',
      'Via',
      'X-IP-Address',
      'X-Azure-SocketIP',
      'X-Forwarded-For',
      'x-clientip',
      'remoteaddr',
      'True-Client-IP',
      'Fastly-Client-IP',
      'X-Envoy-External-Address',
      'CF-Pseudo-IPv4',
      'client_ip',
      'Socket',
    ]) {
      expect(isClientAddressHeader(name), name).toBe(true);
    }
    for (const name of [
      'Accept',
      'User-Agent',
      'X-Zip-Code',
      'Content-Type',
      'Referer',
      'X-Request-Id',
      'Viable',
    ]) {
      expect(isClientAddressHeader(name), name).toBe(false);
    }
    const event = stripIp({
      request: {
        headers: {
          'CloudFront-Viewer-Address': '203.0.113.4:443',
          Via: '1.1 203.0.113.6',
          'X-Azure-SocketIP': '203.0.113.10',
          Accept: '*/*',
        },
      },
    });
    expect(event.request!.headers).toEqual({ Accept: '*/*' });
  });
});
