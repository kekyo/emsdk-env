// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

/**
 * Public types for configuring emsdk-env.
 *
 * Re-exported from `./types`.
 */
export type * from './types';

/**
 * Prepare the Emscripten SDK in the local cache and return the SDK root path.
 */
export { prepareEmsdk } from './emsdk';
/**
 * Build WASM binaries based on the provided build rule.
 */
export { buildWasm } from './build';
