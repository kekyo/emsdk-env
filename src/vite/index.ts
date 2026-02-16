// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import type { Plugin } from 'vite';
import { prepareEmsdk } from '../index';
import type { PrepareEmsdkOptions } from '../index';

const emsdkEnv = (options: PrepareEmsdkOptions): Plugin => ({
  name: 'emsdkEnv',
  apply: 'build',
  enforce: 'pre',
  async buildStart() {
    await prepareEmsdk(options);
  },
});

export default emsdkEnv;
