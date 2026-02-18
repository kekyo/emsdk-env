// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { WASI } from 'node:wasi';

const wasmPath = resolve('src', 'wasm', 'add.wasm');
const wasmBuffer = await readFile(wasmPath);

const wasi = new WASI({ version: 'preview1' });
const { instance } = await WebAssembly.instantiate(wasmBuffer, {
  wasi_snapshot_preview1: wasi.wasiImport,
});

if (typeof instance.exports._initialize === 'function') {
  wasi.initialize(instance);
}

const exports = instance.exports;
const add = exports.add ?? exports._add;

if (typeof add !== 'function') {
  throw new Error('add function not found in wasm exports.');
}

const result = add(2, 3);
console.log(`add(2, 3) = ${result}`);
