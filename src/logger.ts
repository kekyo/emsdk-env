// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

/**
 * Logger interface
 */
export interface Logger {
  /**
   * Log an debug message
   * @param msg - The message to log
   */
  readonly debug: (msg: string) => void;
  /**
   * Log an info message
   * @param msg - The message to log
   */
  readonly info: (msg: string) => void;
  /**
   * Log a warning message
   * @param msg - The message to log
   */
  readonly warn: (msg: string) => void;
  /**
   * Log an error message
   * @param msg - The message to log
   */
  readonly error: (msg: string) => void;
}

// Simple logger implementation with prefix
export const createConsoleLogger = (prefix: string): Logger => {
  return {
    debug: (msg: string) => console.debug(`[${prefix}]: ${msg}`),
    info: (msg: string) => console.info(`[${prefix}]: ${msg}`),
    warn: (msg: string) => console.warn(`[${prefix}]: ${msg}`),
    error: (msg: string) => console.error(`[${prefix}]: ${msg}`),
  };
};
