// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import type { LogLevel, Logger as ViteLogger } from 'vite';
import createDebug from 'debug';
import { Logger } from '../logger';

// Vite logger adapter with prefix
export const createViteLoggerAdapter = (
  viteLogger: ViteLogger,
  logLevel: LogLevel,
  prefix: string
): Logger => {
  // Create debug instance with vite:plugin:prettier-max namespace
  const debug = createDebug('vite:plugin:emsdk-vite');

  return {
    debug: (msg: string) => {
      // Use debug module for debug level (enabled with vite --debug or DEBUG=vite:*)
      debug(msg);
    },
    info:
      logLevel !== 'silent'
        ? (msg: string) => viteLogger.info(`[${prefix}]: ${msg}`)
        : () => {},
    warn:
      logLevel === 'warn' || logLevel === 'info' || logLevel === 'error'
        ? (msg: string) => viteLogger.warn(`[${prefix}]: ${msg}`)
        : () => {},
    error:
      logLevel !== 'silent'
        ? (msg: string) => viteLogger.error(`[${prefix}]: ${msg}`)
        : () => {},
  };
};
