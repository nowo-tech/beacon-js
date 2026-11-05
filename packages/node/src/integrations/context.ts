import { arch, hostname, release, type } from 'node:os';
import type { Integration } from '@nowo-tech/beacon-core';

export interface ContextOptions {
  sendDefaultPii?: boolean;
}

/** `contexts.runtime`, `os`, `app` and `device` (contract §8.1). `server_name` only with `sendDefaultPii`. */
export function contextIntegration(options: ContextOptions = {}): Integration {
  const appStart = new Date(Date.now() - process.uptime() * 1000).toISOString();
  return {
    name: 'Context',
    processEvent(event) {
      event.contexts = {
        runtime: { name: 'node', version: process.versions.node },
        os: { name: type(), version: release() },
        app: { app_start_time: appStart, app_memory: process.memoryUsage().rss },
        device: { arch: arch() },
        ...event.contexts,
      };
      if (options.sendDefaultPii && event.server_name === undefined) event.server_name = hostname();
      return event;
    },
  };
}
