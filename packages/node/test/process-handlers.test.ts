import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, close, initClient, type PlatformConfig } from '@nowo-tech/beacon-core';
import { nodePlatform } from '../src/init.js';
import { onUnhandledRejectionIntegration, rejectionMode } from '../src/integrations/rejection.js';
import { shutdownIntegration } from '../src/integrations/shutdown.js';
import { onUncaughtExceptionIntegration } from '../src/integrations/uncaught.js';
import { eventOf, fakeProcess, recordingTransport, SERVER_DSN } from './helpers.js';

afterEach(async () => {
  await close(100);
});

function setup(integration: ReturnType<typeof onUncaughtExceptionIntegration>) {
  const transport = recordingTransport();
  const platform: PlatformConfig = { ...nodePlatform(), defaultIntegrations: [integration] };
  const client = initClient({ dsn: SERVER_DSN, transport }, platform);
  return { client, transport };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe('OnUncaughtException', () => {
  it('captures fatal, flushes, then exits with code 1', async () => {
    const proc = fakeProcess();
    const { client, transport } = setup(
      onUncaughtExceptionIntegration({ process: proc, shutdownTimeoutMs: 100 }),
    );
    const flush = vi.spyOn(client, 'flush');
    proc.emit('uncaughtException', new Error('crash'));
    await tick();
    expect(flush).toHaveBeenCalledWith(100);
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(eventOf(transport.requests[0]!)).toMatchObject({
      level: 'fatal',
      logger: 'onUncaughtException',
      exception: { values: [{ mechanism: { type: 'onuncaughtexception', handled: false } }] },
    });
    proc.emit('uncaughtException', new Error('again'));
    expect(proc.exit).toHaveBeenCalledTimes(2);
  });

  it('with exitOnUncaught false only captures when another listener exists', async () => {
    const proc = fakeProcess();
    proc.on('uncaughtException', () => {});
    const { transport } = setup(
      onUncaughtExceptionIntegration({ process: proc, exitOnUncaught: false }),
    );
    proc.emit('uncaughtException', new Error('kept alive by the app'));
    await tick();
    expect(proc.exit).not.toHaveBeenCalled();
    expect(transport.requests).toHaveLength(1);
    const lonely = fakeProcess();
    setup(onUncaughtExceptionIntegration({ process: lonely, exitOnUncaught: false }));
    lonely.emit('uncaughtException', new Error('nobody else'));
    await tick();
    expect(lonely.exit).toHaveBeenCalledWith(1);
  });

  it('removes its listener on close', async () => {
    const proc = fakeProcess();
    const integration = onUncaughtExceptionIntegration({ process: proc });
    setup(integration);
    expect(proc.listenerCount('uncaughtException')).toBe(1);
    await close(10);
    expect(proc.listenerCount('uncaughtException')).toBe(0);
    integration.teardown!();
    expect(onUncaughtExceptionIntegration().name).toBe('OnUncaughtException');
  });
});

describe('OnUnhandledRejection', () => {
  it('reads the mode from execArgv and NODE_OPTIONS', () => {
    expect(rejectionMode(fakeProcess())).toBe('throw');
    expect(rejectionMode(fakeProcess(['--unhandled-rejections=warn']))).toBe('warn');
    expect(
      rejectionMode(
        fakeProcess([], { NODE_OPTIONS: '--max-old-space-size=100 --unhandled-rejections strict' }),
      ),
    ).toBe('strict');
  });

  it('in throw mode captures, flushes, prints and exits 1', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const proc = fakeProcess();
    const { transport } = setup(
      onUnhandledRejectionIntegration({ process: proc, shutdownTimeoutMs: 50 }),
    );
    proc.emit('unhandledRejection', 'plain reason');
    await tick();
    expect(error).toHaveBeenCalledWith('plain reason');
    expect(proc.exit).toHaveBeenCalledWith(1);
    expect(eventOf(transport.requests[0]!)).toMatchObject({
      logger: 'onUnhandledRejection',
      exception: {
        values: [
          {
            value: 'Non-Error promise rejection captured: plain reason',
            mechanism: { handled: false },
          },
        ],
      },
    });
  });

  it('uses the default flush timeout', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const proc = fakeProcess();
    const { client } = setup(onUnhandledRejectionIntegration({ process: proc }));
    const flush = vi.spyOn(client, 'flush');
    proc.emit('unhandledRejection', new Error('r'));
    expect(flush).toHaveBeenCalledWith(2000);
    await tick();
    await close(10);
    const sig = fakeProcess();
    const second = setup(shutdownIntegration({ process: sig, shutdownHandlers: ['SIGINT'] }));
    const flush2 = vi.spyOn(second.client, 'flush');
    sig.emit('SIGINT');
    expect(flush2).toHaveBeenCalledWith(2000);
  });

  it('only captures in warn mode, sets exitCode with warn-with-error-code, defers to app listeners', async () => {
    const warnProc = fakeProcess();
    setup(onUnhandledRejectionIntegration({ process: warnProc, mode: 'warn' }));
    warnProc.emit('unhandledRejection', new Error('w'));
    await tick();
    expect(warnProc.exit).not.toHaveBeenCalled();
    await close(10);
    const codeProc = fakeProcess();
    setup(onUnhandledRejectionIntegration({ process: codeProc, mode: 'warn-with-error-code' }));
    codeProc.emit('unhandledRejection', new Error('c'));
    expect(codeProc.exitCode).toBe(1);
    await close(10);
    const appProc = fakeProcess(['--unhandled-rejections=strict']);
    appProc.on('unhandledRejection', () => {});
    setup(onUnhandledRejectionIntegration({ process: appProc }));
    appProc.emit('unhandledRejection', new Error('a'));
    await tick();
    expect(appProc.exit).not.toHaveBeenCalled();
    await close(10);
    expect(appProc.listenerCount('unhandledRejection')).toBe(1);
    const integration = onUnhandledRejectionIntegration();
    integration.teardown!();
    expect(integration.name).toBe('OnUnhandledRejection');
  });
});

describe('Shutdown', () => {
  it('flushes on beforeExit once at a time', async () => {
    const proc = fakeProcess();
    const { client } = setup(shutdownIntegration({ process: proc }));
    const flush = vi.spyOn(client, 'flush');
    proc.emit('beforeExit');
    proc.emit('beforeExit');
    expect(flush).toHaveBeenCalledTimes(1);
    await tick();
    proc.emit('beforeExit');
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it('flushes on opt-in signals, removes its listener and re-raises', async () => {
    const proc = fakeProcess();
    setup(
      shutdownIntegration({ process: proc, shutdownHandlers: ['SIGTERM'], shutdownTimeoutMs: 50 }),
    );
    expect(proc.listenerCount('SIGTERM')).toBe(1);
    proc.emit('SIGTERM');
    expect(proc.listenerCount('SIGTERM')).toBe(0);
    await tick();
    expect(proc.kill).toHaveBeenCalledWith(4242, 'SIGTERM');
    await close(10);
    expect(proc.listenerCount('beforeExit')).toBe(0);
    expect(shutdownIntegration().name).toBe('Shutdown');
  });
});

describe('Client reuse', () => {
  it('is a core Client', () => {
    expect(setup(shutdownIntegration({ process: fakeProcess() })).client).toBeInstanceOf(Client);
  });
});
