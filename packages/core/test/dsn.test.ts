import { describe, expect, it } from 'vitest';
import { BeaconConfigError, defaultDsnParser, publicDsn } from '../src/dsn.js';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('DSN parser', () => {
  it('parses a server DSN', () => {
    const dsn = defaultDsnParser.parse(
      `https://pk:test-secret-not-real@beacon.test:8443/beacon/${UUID}`,
    );
    expect(dsn).toMatchObject({
      protocol: 'https',
      host: 'beacon.test:8443',
      pathPrefix: '/beacon',
      projectId: UUID,
      publicKey: 'pk',
      secret: 'test-secret-not-real',
      kind: 'server',
    });
    expect(dsn.envelopeUrl()).toBe(`https://beacon.test:8443/beacon/api/${UUID}/envelope/`);
    expect(dsn.otlpUrl('logs')).toBe(`https://beacon.test:8443/beacon/api/${UUID}/otlp/v1/logs`);
    expect(publicDsn(dsn)).toBe(`https://pk@beacon.test:8443/beacon/${UUID}`);
    expect(publicDsn(dsn, true)).toBe(
      `https://pk:test-secret-not-real@beacon.test:8443/beacon/${UUID}`,
    );
  });

  it('parses a browser DSN and a legacy numeric id', () => {
    const dsn = defaultDsnParser.parse('http://bk_test_0000@localhost:4200/42');
    expect(dsn).toMatchObject({
      kind: 'browser',
      pathPrefix: '',
      projectId: '42',
      protocol: 'http',
    });
    expect(dsn.secret).toBeUndefined();
    expect(dsn.envelopeUrl()).toBe('http://localhost:4200/api/42/envelope/');
    expect(publicDsn(dsn, true)).toBe('http://bk_test_0000@localhost:4200/42');
    expect(defaultDsnParser.parse(`http://bk_x@127.0.0.1/${UUID}`).host).toBe('127.0.0.1');
    expect(defaultDsnParser.parse(`http://bk_x@host.docker.internal/${UUID}`).host).toBe(
      'host.docker.internal',
    );
  });

  it.each([
    ['not a url', 'not a URL'],
    [`ftp://pk@beacon.test/${UUID}`, 'scheme'],
    [`http://pk@beacon.test/${UUID}`, 'local hosts'],
    [`https://pk@beacon.test/${UUID}?beacon_key=x`, 'query'],
    [`https://pk@beacon.test/${UUID}#x`, 'query'],
    [`https://beacon.test/${UUID}`, 'public key'],
    ['https://pk@beacon.test/', 'project id'],
    ['https://pk@beacon.test/not-a-uuid', 'project id'],
    [`https://bk_x:test-secret-not-real@beacon.test/${UUID}`, 'browser key'],
  ])('refuses %s', (input, reason) => {
    let error: unknown;
    try {
      defaultDsnParser.parse(input);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BeaconConfigError);
    expect((error as Error).name).toBe('BeaconConfigError');
    expect((error as Error).message).toContain(reason);
    expect((error as Error).message).not.toContain('test-secret-not-real');
    expect((error as Error).message).not.toContain(input);
  });

  it.each([
    [
      'https://pk\r\nX-Injected: 1@beacon.test/00000000-0000-4000-8000-000000000001',
      'control characters',
    ],
    ['https://pk%0D%0A@beacon.test/00000000-0000-4000-8000-000000000001', 'keys may only contain'],
    [
      'https://pk:s%E0%A4%A@beacon.test/00000000-0000-4000-8000-000000000001',
      'keys may only contain',
    ],
    [
      'https://pk:sec ret@beacon.test/00000000-0000-4000-8000-000000000001',
      'keys may only contain',
    ],
  ])('refuses hostile keys %j with a BeaconConfigError', (input, reason) => {
    expect(() => defaultDsnParser.parse(input)).toThrow(BeaconConfigError);
    expect(() => defaultDsnParser.parse(input)).toThrow(reason);
  });
});
