// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { BuildWasmCommonOptions, WasmBuildRule } from '../types';

/////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Options for the emsdk-env Vite plugin.
 */
export interface EmsdkVitePluginOptions
  extends BuildWasmCommonOptions, WasmBuildRule {}
