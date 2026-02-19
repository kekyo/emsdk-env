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

/**
 * Options for the emsdk-env preparer.
 */
export interface PrepareEmsdkOptions {
  /**
   * Emscripten SDK version to install (e.g. "latest" or a specific tag).
   */
  readonly targetVersion?: string;
  /**
   * Cache directory for the SDK.
   */
  readonly cacheDir?: string;
  /**
   * Custom emsdk repository URL.
   */
  readonly repoUrl?: string;
  /**
   * Git executable path.
   */
  readonly gitPath?: string;
  /**
   * Abort signal for cancelling the operation.
   */
  readonly signal?: AbortSignal;
}

/**
 * Value type for preprocessor defines.
 */
export type DefineValue = string | number | boolean;

/**
 * Common build options shared across targets.
 */
export interface WasmBuildCommonOptions {
  /**
   * Additional compile options passed to `emcc -c`.
   */
  readonly options?: readonly string[];
  /**
   * Additional link options passed to `emcc` during the final link step.
   */
  readonly linkOptions?: readonly string[];
  /**
   * Symbols to export (mapped to `-s EXPORTED_FUNCTIONS=...`).
   */
  readonly exports?: readonly string[];
  /**
   * Include directories added as `-I` flags.
   */
  readonly includeDirs?: readonly string[];
  /**
   * Preprocessor defines applied as `-D` flags.
   */
  readonly defines?: Record<string, DefineValue>;
}

/**
 * Per-target build configuration.
 */
export interface WasmBuildTarget {
  /**
   * Output WASM file path (relative to `outDir` unless absolute).
   */
  readonly outFile?: string;
  /**
   * Source file globs (relative to `srcDir` unless absolute).
   */
  readonly sources?: readonly string[];
  /**
   * Source groups compiled with additional options.
   */
  readonly sourceGroups?: readonly WasmBuildSourceGroup[];
  /**
   * Compile options applied to this target.
   */
  readonly options?: readonly string[];
  /**
   * Link options applied to this target.
   */
  readonly linkOptions?: readonly string[];
  /**
   * Symbols to export for this target.
   */
  readonly exports?: readonly string[];
  /**
   * Include directories for this target.
   */
  readonly includeDirs?: readonly string[];
  /**
   * Preprocessor defines for this target.
   */
  readonly defines?: Record<string, DefineValue>;
}

/**
 * Group of sources compiled with additional options.
 */
export interface WasmBuildSourceGroup {
  /**
   * Source file globs for this group (relative to `srcDir` unless absolute).
   */
  readonly sources: readonly string[];
  /**
   * Additional compile options for this group.
   */
  readonly options?: readonly string[];
  /**
   * Include directories for this group.
   */
  readonly includeDirs?: readonly string[];
  /**
   * Preprocessor defines for this group.
   */
  readonly defines?: Record<string, DefineValue>;
}

/**
 * Build rule describing targets and shared options.
 */
export interface WasmBuildRule {
  /**
   * Shared build options applied to all targets.
   */
  readonly common?: WasmBuildCommonOptions;
  /**
   * Target build configurations keyed by target name.
   */
  readonly targets: Record<string, WasmBuildTarget>;
}

/**
 * Options for building WASM binaries.
 */
export interface BuildWasmOptions {
  /**
   * Emscripten SDK setup options.
   */
  readonly emsdk?: PrepareEmsdkOptions;
  /**
   * Build rules describing targets and shared options.
   */
  readonly rule: WasmBuildRule;
  /**
   * Project root directory (defaults to `process.cwd()`).
   */
  readonly root?: string;
  /**
   * Source root directory (defaults to `wasm`).
   */
  readonly srcDir?: string;
  /**
   * Output directory for generated WASM files (defaults to `src/wasm`).
   */
  readonly outDir?: string;
  /**
   * Temporary build directory (defaults to OS temp dir).
   */
  readonly buildDir?: string;
  /**
   * Remove the build directory after completion.
   */
  readonly cleanupBuildDir?: boolean;
  /**
   * Compile sources in parallel.
   */
  readonly parallel?: boolean;
  /**
   * Custom logger implementation.
   */
  readonly logger?: Logger;
}

/**
 * Result of a buildWasm invocation.
 */
export interface BuildWasmResult {
  /**
   * Resolved Emscripten SDK root path.
   */
  readonly emsdkRoot: string;
  /**
   * Output WASM paths keyed by target name.
   */
  readonly outFiles: Record<string, string>;
}
