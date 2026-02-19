// emsdk-env - Emscripten environment builder
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/emsdk-env

const run = async () => {
  const resultDiv = document.getElementById('results')!;

  try {
    const wasmUrl = new URL('./wasm/add.wasm', import.meta.url);
    const response = await fetch(wasmUrl);
    const wasmBuffer = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(wasmBuffer, {});

    const exports = instance.exports as {
      add?: (a: number, b: number) => number;
      _add?: (a: number, b: number) => number;
    };
    const add = exports.add ?? exports._add;
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
