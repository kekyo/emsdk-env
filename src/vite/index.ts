// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import type { Plugin, ResolvedConfig } from 'vite';

import { EmsdkVitePluginOptions } from './types';
import { createViteLoggerAdapter } from './logger';
import { buildWasm } from '../index';

/////////////////////////////////////////////////////////////////////////////////////////////////

const emsdkEnv = (options: EmsdkVitePluginOptions): Plugin => {
  let resolvedConfig: ResolvedConfig | undefined;
  return {
    name: 'emsdkEnv',
    apply: 'build',
    enforce: 'pre',
    configResolved(config) {
      resolvedConfig = config;
    },
    async buildStart() {
      if (!resolvedConfig) {
        throw new Error('Vite config was not resolved.');
      }
      const logger = createViteLoggerAdapter(
        resolvedConfig.logger,
        resolvedConfig.logLevel ?? 'info',
        'emsdk-env'
      );
      const { emsdk, srcDir, outDir, buildDir, ...rule } = options;
      const buildOptions = {
        emsdk,
        rule,
        root: resolvedConfig.root,
        logger,
        ...(srcDir !== undefined ? { srcDir } : {}),
        ...(outDir !== undefined ? { outDir } : {}),
        ...(buildDir !== undefined ? { buildDir } : {}),
      };
      await buildWasm(buildOptions);
    },
  };
};

export default emsdkEnv;
