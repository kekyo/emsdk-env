// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { defineConfig } from 'vite';
import emsdkEnv from 'emsdk-env/vite';

export default defineConfig({
  plugins: [
    emsdkEnv({
      emsdk: {
        targetVersion: 'latest',
      },
      recipe: {
        common: {
          options: ['-O3', '-std=c99'],
          linkOptions: ['-s', 'STANDALONE_WASM=1', '--no-entry'],
        },
        targets: {
          add: {
            sources: ['wasm/add.c'],
            linkOptions: ['-s', 'EXPORTED_FUNCTIONS=["_add"]'],
          },
        },
      },
    }),
  ],
  build: {
    lib: {
      entry: 'src/main.ts',
      formats: ['es'],
      fileName: 'index',
    },
    emptyOutDir: false,
  },
});
