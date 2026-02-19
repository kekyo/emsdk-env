// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

/////////////////////////////////////////////////////////////////////////////////////////////////

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

export interface PrepareEmsdkOptions {
  targetVersion?: string;
  cacheDir?: string;
  repoUrl?: string;
  gitPath?: string;
  signal?: AbortSignal;
}

export type DefineValue = string | number | boolean;

export interface WasmBuildCommonOptions {
  options?: string[];
  linkOptions?: string[];
  exports?: string[];
  includeDirs?: string[];
  defines?: Record<string, DefineValue>;
}

export interface WasmBuildTarget {
  outFile?: string;
  sources?: string[];
  options?: string[];
  linkOptions?: string[];
  exports?: string[];
  includeDirs?: string[];
  defines?: Record<string, DefineValue>;
}

export interface WasmBuildRule {
  common?: WasmBuildCommonOptions;
  targets: Record<string, WasmBuildTarget>;
}

export interface BuildWasmOptions {
  emsdk?: PrepareEmsdkOptions;
  rule: WasmBuildRule;
  root?: string;
  srcDir?: string;
  outDir?: string;
  buildDir?: string;
  logger?: Logger;
}

export interface BuildWasmResult {
  emsdkRoot: string;
  outFiles: Record<string, string>;
}
