// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { defineConfig } from 'vite';
import emsdkEnv from 'emsdk-env/vite';

export default defineConfig({
  plugins: [
    emsdkEnv({
      targets: {
        add: {
          options: ['-O3', '-std=c99'],
          linkOptions: ['-s', 'STANDALONE_WASM=1', '--no-entry'],
          exports: ['_add'],
        },
      },
    }),
  ],
  server: {
    open: true,
  },
});
