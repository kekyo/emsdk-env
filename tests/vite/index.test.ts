// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { describe, expect, test, vi } from 'vitest';
import { prepareEmsdk } from '../../src/index';
import emsdkEnv from '../../src/vite/index';

vi.mock('../../src/index', () => ({
  prepareEmsdk: vi.fn().mockResolvedValue('/mock/emsdk'),
}));

describe('emsdkEnv', () => {
  test('runs prepareEmsdk before build', async () => {
    const options = {
      targetVersion: '3.1.0',
      cacheDir: '/mock/cache',
    };
    const plugin = emsdkEnv(options);

    expect(plugin.name).toBe('emsdkEnv');
    expect(plugin.apply).toBe('build');
    expect(plugin.enforce).toBe('pre');

    await (plugin.buildStart as any).call({} as unknown as object);

    expect(prepareEmsdk).toHaveBeenCalledTimes(1);
    expect(prepareEmsdk).toHaveBeenCalledWith(options);
  });
});
