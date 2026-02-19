// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { join } from 'path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { buildWasm } from '../../src/index';
import emsdkEnv from '../../src/vite/index';

const { debugMock, debugFactory } = vi.hoisted(() => ({
  debugMock: vi.fn(),
  debugFactory: vi.fn(() => debugMock),
}));

vi.mock('debug', () => ({
  default: debugFactory,
}));

vi.mock('../../src/index', () => ({
  buildWasm: vi.fn().mockResolvedValue({
    emsdkRoot: '/mock/emsdk',
    outFiles: {},
  }),
}));

describe('emsdkEnv', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('runs buildWasm before build', async () => {
    const options = {
      emsdk: {
        targetVersion: '3.1.0',
        cacheDir: '/mock/cache',
      },
      targets: {
        target1: {
          sources: ['**/*.c'],
        },
      },
    };
    const plugin = emsdkEnv(options);

    expect(plugin.name).toBe('emsdkEnv');
    expect(plugin.enforce).toBe('pre');

    await (plugin.configResolved as any)?.call({} as unknown as object, {
      root: '/mock/root',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      logLevel: 'info',
      command: 'build',
    });
    await (plugin.buildStart as any).call({} as unknown as object);

    expect(buildWasm).toHaveBeenCalledTimes(1);
    expect(buildWasm).toHaveBeenCalledWith(
      expect.objectContaining({
        emsdk: options.emsdk,
        rule: {
          targets: options.targets,
        },
        root: '/mock/root',
        logger: expect.any(Object),
      })
    );
  });

  test('allows emsdk to be omitted', async () => {
    const options = {
      targets: {
        target1: {
          sources: ['**/*.c'],
        },
      },
    };
    const plugin = emsdkEnv(options);

    await (plugin.configResolved as any)?.call({} as unknown as object, {
      root: '/mock/root',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      logLevel: 'info',
      command: 'build',
    });
    await (plugin.buildStart as any).call({} as unknown as object);

    expect(buildWasm).toHaveBeenCalledTimes(1);
    expect(buildWasm).toHaveBeenCalledWith(
      expect.objectContaining({
        rule: {
          targets: options.targets,
        },
        root: '/mock/root',
        logger: expect.any(Object),
      })
    );
    const call = vi.mocked(buildWasm).mock.calls[0]?.[0];
    expect(call?.emsdk).toBeUndefined();
  });

  test('runs buildWasm on serve and reloads after changes', async () => {
    const options = {
      srcDir: 'wasm',
      common: {
        includeDirs: ['include'],
      },
      targets: {
        target1: {
          includeDirs: ['include/target'],
        },
      },
    };
    const plugin = emsdkEnv(options);

    await (plugin.configResolved as any)?.call({} as unknown as object, {
      root: '/mock/root',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      logLevel: 'info',
      command: 'serve',
    });

    const handlers: Record<string, (path: string) => Promise<void>> = {};
    const server = {
      watcher: {
        add: vi.fn(),
        on: vi.fn((event: string, handler: (path: string) => Promise<void>) => {
          handlers[event] = handler;
        }),
      },
      ws: {
        send: vi.fn(),
      },
    };

    await (plugin.configureServer as any)?.call(
      {} as unknown as object,
      server
    );

    expect(buildWasm).toHaveBeenCalledTimes(1);
    expect(debugFactory).toHaveBeenCalledWith('vite:plugin:emsdk-vite');
    expect(debugMock).toHaveBeenCalledWith('watch root: /mock/root');
    expect(debugMock).toHaveBeenCalledWith('watch srcDir: /mock/root/wasm');
    const includeLog = debugMock.mock.calls
      .map((call) => call[0])
      .find((message) => message.startsWith('watch includeDirs:'));
    expect(includeLog).toContain('/mock/root/include');
    expect(includeLog).toContain('/mock/root/include/target');

    const watchArgs = vi.mocked(server.watcher.add).mock.calls[0]?.[0] ?? [];
    const srcPattern = join('/mock/root', 'wasm');
    const includePattern = join('/mock/root', 'include');
    const includeTargetPattern = join('/mock/root', 'include', 'target');
    expect(watchArgs).toEqual(
      expect.arrayContaining([srcPattern, includePattern, includeTargetPattern])
    );

    await handlers.change?.('/mock/root/wasm/alpha.c');

    expect(buildWasm).toHaveBeenCalledTimes(2);
    expect(server.ws.send).toHaveBeenCalledWith({ type: 'full-reload' });

    await handlers.change?.('/mock/root/src/wasm/add.wasm');

    expect(buildWasm).toHaveBeenCalledTimes(2);
  });
});
