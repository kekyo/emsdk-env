# emsdk-env demo

This is a minimal web app demo that builds a wasm module with the emsdk-env Vite plugin
and shows the result in the browser.

## Setup

From `demo/`:

```bash
npm install
```

## Build

```bash
npm run build
```

The wasm output is generated at `demo/src/wasm/add.wasm`.

## Run demo

Open `demo/dist/index.html` in a browser after building.
