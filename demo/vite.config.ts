// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { defineConfig } from 'vite';
import emsdkEnv from 'emsdk-env/vite';

export default defineConfig({
  plugins: [
    emsdkEnv({
      generatedLoader: {
        enable: true,
      },
      targets: {
        add: {
          options: ['-O3', '-std=c99'],
          linkOptions: ['--no-entry'],
          linkDirectives: { STANDALONE_WASM: 1 },
          exports: ['_add'],
        },
      },
    }),
  ],
  server: {
    open: true,
  },
});
