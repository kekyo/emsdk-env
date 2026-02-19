// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { PrepareEmsdkOptions, WasmBuildRule } from '../types';

/////////////////////////////////////////////////////////////////////////////////////////////////

export interface EmsdkVitePluginOptions extends WasmBuildRule {
  emsdk: PrepareEmsdkOptions;
  srcDir?: string;
  outDir?: string;
  buildDir?: string;
}
