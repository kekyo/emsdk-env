// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { describe, expect, test, vi } from 'vitest';

import { buildWasm } from '../../src/index';
import emsdkEnv from '../../src/vite/index';

vi.mock('../../src/index', () => ({
  buildWasm: vi.fn().mockResolvedValue({
    emsdkRoot: '/mock/emsdk',
    outFiles: {},
  }),
}));

describe('emsdkEnv', () => {
  test('runs buildWasm before build', async () => {
    const options = {
      emsdk: {
        targetVersion: '3.1.0',
        cacheDir: '/mock/cache',
      },
      targets: {
        target1: {
          sources: ['wasm/**/*.c'],
        },
      },
    };
    const plugin = emsdkEnv(options);

    expect(plugin.name).toBe('emsdkEnv');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');

    await (plugin.configResolved as any)?.call({} as unknown as object, {
      root: '/mock/root',
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      logLevel: 'info',
    });
    await (plugin.buildStart as any).call({} as unknown as object);

    expect(buildWasm).toHaveBeenCalledTimes(1);
    expect(buildWasm).toHaveBeenCalledWith({
      emsdk: options.emsdk,
      rule: {
        targets: options.targets,
      },
      root: '/mock/root',
      srcDir: undefined,
      outDir: undefined,
      buildDir: undefined,
      logger: expect.any(Object),
    });
  });
});
