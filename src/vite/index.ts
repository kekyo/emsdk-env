// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import type { Plugin, ResolvedConfig } from 'vite';
import { buildWasm } from '../index';
import type { PrepareEmsdkOptions, WasmBuildRecipe } from '../index';
import { createViteLoggerAdapter } from './logger';

export type EmsdkVitePluginOptions = {
  emsdk: PrepareEmsdkOptions;
  recipe: WasmBuildRecipe;
  srcDir?: string;
  outDir?: string;
  buildDir?: string;
};

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
      const buildOptions = {
        emsdk: options.emsdk,
        recipe: options.recipe,
        root: resolvedConfig.root,
        logger,
        ...(options.srcDir !== undefined ? { srcDir: options.srcDir } : {}),
        ...(options.outDir !== undefined ? { outDir: options.outDir } : {}),
        ...(options.buildDir !== undefined
          ? { buildDir: options.buildDir }
          : {}),
      };
      await buildWasm(buildOptions);
    },
  };
};

export default emsdkEnv;
