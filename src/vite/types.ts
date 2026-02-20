// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { PrepareEmsdkOptions, WasmBuildRule } from '../types';

/////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Options for the emsdk-env Vite plugin.
 */
export interface EmsdkVitePluginOptions extends WasmBuildRule {
  /**
   * Emscripten SDK setup options.
   */
  emsdk?: PrepareEmsdkOptions;
  /**
   * Source root directory (defaults to `wasm`).
   */
  srcDir?: string;
  /**
   * Package imports that provide include/lib directories.
   */
  imports?: readonly string[];
  /**
   * Output directory for generated WASM files (defaults to `src/wasm`).
   */
  outDir?: string;
  /**
   * Output directory for generated archives (defaults to `lib`).
   */
  libDir?: string;
  /**
   * Temporary build directory (defaults to OS temp dir).
   */
  buildDir?: string;
  /**
   * Remove the build directory after completion.
   */
  cleanupBuildDir?: boolean;
}
