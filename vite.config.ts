// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';
import prettierMax from 'prettier-max';

export default defineConfig({
  plugins: [
    prettierMax({
      typescript: 'tsconfig.tests.json',
    }),
    screwUp({
      outputMetadataFile: true,
    }),
    dts({
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(
          fileURLToPath(new URL('.', import.meta.url)),
          'src/index.ts'
        ),
        vite: resolve(
          fileURLToPath(new URL('.', import.meta.url)),
          'src/vite/index.ts'
        ),
      },
      name: 'emsdk-env',
      formats: ['es', 'cjs'],
      fileName: (format, entryName) =>
        `${entryName}.${format === 'es' ? 'mjs' : 'cjs'}`,
    },
    rollupOptions: {
      external: [
        'child_process',
        'fs',
        'fs/promises',
        'os',
        'path',
        'url',
        'simple-git',
      ],
    },
    target: 'es2018',
    sourcemap: true,
    minify: false,
  },
});
