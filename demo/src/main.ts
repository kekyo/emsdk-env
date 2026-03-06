// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

import { loadAddWasm } from './generated/wasm-loader';

interface AddExports {
  add?: (a: number, b: number) => number;
}

const run = async () => {
  const resultDiv = document.getElementById('results')!;

  try {
    const wasm = await loadAddWasm<AddExports>();
    const add = wasm.exports.add;
    if (typeof add !== 'function') {
      throw new Error('add function not found in wasm exports.');
    }

    const result = add(2, 3);

    resultDiv.textContent = `WASM function invoked: add(2, 3) = ${result}`;
  } catch (e: unknown) {
    resultDiv.textContent =
      e instanceof Error ? e.message : (e?.toString() ?? '(undefined)');
  }
};

void run();
