// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { Logger } from './types';

/////////////////////////////////////////////////////////////////////////////////////////////////

// Simple logger implementation with prefix
export const createConsoleLogger = (prefix: string): Logger => {
  return {
    debug: (msg: string) => console.debug(`[${prefix}]: ${msg}`),
    info: (msg: string) => console.info(`[${prefix}]: ${msg}`),
    warn: (msg: string) => console.warn(`[${prefix}]: ${msg}`),
    error: (msg: string) => console.error(`[${prefix}]: ${msg}`),
  };
};
