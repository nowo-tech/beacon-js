import { EventEmitter } from 'node:events';
import { vi, type Mock } from 'vitest';
import type { Transport, TransportRequest, TransportResult } from '@nowo-tech/beacon-core';
import type { ProcessLike } from '../src/process.js';

export const SERVER_DSN =
  'https://test-public:test-secret-not-real@beacon.test/00000000-0000-4000-8000-000000000001';
export const BROWSER_DSN =
  'https://bk_test_0000000000000000@beacon.test/00000000-0000-4000-8000-000000000001';

export interface RecordingTransport extends Transport {
  requests: TransportRequest[];
}

export function recordingTransport(...results: TransportResult[]): RecordingTransport {
  const requests: TransportRequest[] = [];
  return {
    requests,
    send: vi.fn((request: TransportRequest) => {
      requests.push(request);
      return Promise.resolve(results.shift() ?? { kind: 'ok' as const });
    }),
    flush: vi.fn(() => Promise.resolve(true)),
  };
}

export type FakeProcess = ProcessLike &
  EventEmitter & {
    exit: Mock<(code?: number) => void>;
    kill: Mock<(pid: number, signal?: string) => unknown>;
  };

export function fakeProcess(
  execArgv: string[] = [],
  env: Record<string, string> = {},
): FakeProcess {
  const emitter = new EventEmitter() as FakeProcess;
  emitter.exit = vi.fn<(code?: number) => void>();
  emitter.kill = vi.fn<(pid: number, signal?: string) => unknown>();
  emitter.pid = 4242;
  emitter.execArgv = execArgv;
  emitter.env = env;
  return emitter;
}

export function eventOf(request: TransportRequest): Record<string, any> {
  return JSON.parse(request.body.split('\n')[2]!) as Record<string, any>;
}

export function headerOf(request: TransportRequest): Record<string, any> {
  return JSON.parse(request.body.split('\n')[0]!) as Record<string, any>;
}
