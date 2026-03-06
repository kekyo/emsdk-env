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

/////////////////////////////////////////////////////////////////////

/**
 * Options for the emsdk-env preparer.
 */
export interface PrepareEmsdkOptions {
  /**
   * Emscripten SDK version to install (e.g. "latest" or a specific tag. defaults to 'latest').
   */
  readonly targetVersion?: string;
  /**
   * Cache directory for the Emscripten SDK (defaults to `~/.cache/emsdk-env`).
   */
  readonly cacheDir?: string;
  /**
   * Custom Emscripten SDK repository URL (defaults to the official Emscripten SDK GitHub repository).
   */
  readonly repoUrl?: string;
  /**
   * Git executable path (defaults to `git`).
   */
  readonly gitPath?: string;
  /**
   * Abort signal for cancelling the operation.
   */
  readonly signal?: AbortSignal;
}

/////////////////////////////////////////////////////////////////////

/**
 * Value type for preprocessor defines.
 */
export type DefineValue = string | number | boolean | null | undefined;

/**
 * Input type for preprocessor defines.
 */
export type DefineInput =
  | Record<string, DefineValue>
  | Readonly<Map<string, DefineValue>>
  | readonly string[];

/**
 * Value type for linker directives.
 */
export type LinkDirectiveValue = DefineValue | readonly string[];

/**
 * Input type for linker directives.
 */
export type LinkDirectiveInput =
  | Record<string, LinkDirectiveValue>
  | Readonly<Map<string, LinkDirectiveValue>>
  | readonly string[];

/**
 * Options for running wasm-opt on the linked output.
 */
export interface WasmOptOptions {
  /**
   * Enable wasm-opt for this target (defaults to false).
   */
  readonly enable?: boolean;
  /**
   * Additional wasm-opt options.
   */
  readonly options?: readonly string[];
}

/**
 * Build target type for WASM or archive outputs.
 */
export type WasmBuildTargetType = 'wasm' | 'archive';

/**
 * Key-value declaration type.
 * @deprecated Use `DefineInput` or `LinkDirectiveInput`.
 */
export type KeyValueInput = DefineInput;

/**
 * Common build options shared across targets.
 */
export interface WasmBuildCommonOptions {
  /**
   * Common compile options applied to this target.
   */
  readonly options?: readonly string[];
  /**
   * Additional common link options passed to `emcc` during the final link step.
   */
  readonly linkOptions?: readonly string[];
  /**
   * Common linker directives mapped to `-s KEY=VALUE`.
   */
  readonly linkDirectives?: LinkDirectiveInput;
  /**
   * Common symbols to export (mapped to `-s EXPORTED_FUNCTIONS=...`).
   */
  readonly exports?: readonly string[];
  /**
   * Common wasm-opt options applied after linking.
   */
  readonly wasmOpt?: WasmOptOptions;
  /**
   * Common include directories added as `-I` flags (defaults to `$includeDir`).
   */
  readonly includeDirs?: readonly string[];
  /**
   * Common preprocessor defines applied as `-D` flags.
   */
  readonly defines?: DefineInput;
}

/**
 * Per-target build configuration.
 */
export interface WasmBuildTarget {
  /**
   * Target output type (defaults to 'wasm').
   */
  readonly type?: WasmBuildTargetType;
  /**
   * Output file path (relative to `outDir` or `libDir` unless absolute).
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
   * Additional link options passed to `emcc` during the final link step.
   */
  readonly linkOptions?: readonly string[];
  /**
   * Linker directives mapped to `-s KEY=VALUE`.
   */
  readonly linkDirectives?: LinkDirectiveInput;
  /**
   * Common symbols to export (mapped to `-s EXPORTED_FUNCTIONS=...`).
   */
  readonly exports?: readonly string[];
  /**
   * wasm-opt options applied after linking this target.
   */
  readonly wasmOpt?: WasmOptOptions;
  /**
   * Include directories added as `-I` flags.
   */
  readonly includeDirs?: readonly string[];
  /**
   * Preprocessor defines applied as `-D` flags.
   */
  readonly defines?: DefineInput;
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
   * Compile options applied to this target for this group.
   */
  readonly options?: readonly string[];
  /**
   * Include directories added as `-I` flags for this group.
   */
  readonly includeDirs?: readonly string[];
  /**
   * Preprocessor defines applied as `-D` flags for this group.
   */
  readonly defines?: DefineInput;
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

/////////////////////////////////////////////////////////////////////

/**
 * Common options for building WASM binaries.
 */
export interface BuildWasmCommonOptions {
  /**
   * Emscripten SDK setup options (defaults to `targetVersion: 'latest'`).
   */
  readonly emsdk?: PrepareEmsdkOptions;
  /**
   * Package imports that provide include/lib directories.
   */
  readonly imports?: readonly string[];
  /**
   * Source root directory (defaults to `wasm`).
   */
  readonly srcDir?: string;
  /**
   * Default include directory (defaults to `include`).
   */
  readonly includeDir?: string;
  /**
   * Output directory for generated WASM files (defaults to `src/wasm`).
   */
  readonly outDir?: string;
  /**
   * Output directory for generated archives (defaults to `lib`).
   */
  readonly libDir?: string;
  /**
   * Temporary build directory (defaults to OS temp dir).
   */
  readonly buildDir?: string;
  /**
   * Remove the build directory after completion. (defaults to true).
   */
  readonly cleanupBuildDir?: boolean;
  /**
   * Compile sources in parallel (defaults to true).
   */
  readonly parallel?: boolean;
}

/**
 * Options for building WASM binaries.
 */
export interface BuildWasmOptions extends BuildWasmCommonOptions {
  /**
   * Build rules describing targets and shared options.
   */
  readonly rule: WasmBuildRule;
  /**
   * Project root directory (defaults to `process.cwd()`).
   */
  readonly root?: string;
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
   * Output paths keyed by target name.
   */
  readonly outFiles: Record<string, string>;
}
