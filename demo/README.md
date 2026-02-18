# emsdk-env demo

This is a minimal CLI-oriented demo that builds a wasm module with the emsdk-env Vite plugin
and runs it with Node.

## Setup

From `demo/`:

```bash
npm install
```

## Build wasm

```bash
npm run build
```

The wasm output is generated at `demo/src/wasm/add.wasm`.

## Run demo

```bash
npm run demo
```

Expected output:

```
add(2, 3) = 5
```
